import { describe, expect, it, vi } from "vitest";
import { defineSchema } from "../src/core/schema";
import { buildResolutionRequest, emptyViewState, isExposed, matchMentions, normalize } from "../src/index";
import { createJevProvider, DEFAULT_JEV_MODEL, type JevClient } from "../src/server/jev";

const schema = defineSchema([{ id: "value", label: "Market value", kind: "currency" }, { id: "status", kind: "enum" }, { id: "tax_id" }], {
  restricted: ["tax_id"],
  columns: { status: { enumValues: [{ id: "open", label: "Open" }] } },
});
const caps = { operations: ["filter.add", "sort.set"], supportsAtomicApply: true, supportsSnapshotRestore: true, observesChanges: true };
const request = buildResolutionRequest(normalize("open accounts over $1m"), schema, caps, emptyViewState(["value", "status", "tax_id"]));

/** The question keys this provider asks as Choices; every other key is a Noul. */
const isChoice = (k: string) => /_(?:val|bool)\d+$|_dir$|_lit\d+$|_kind$/.test(k);

type Seen = { questions?: Record<string, unknown>; state?: unknown; model?: string };
const fakeClient = (answer: (name: string) => unknown, seen: Seen = {}): JevClient => ({
  async systemOne(req) {
    seen.questions = req.questions;
    seen.state = req.state;
    if (req.model !== undefined) seen.model = req.model;
    return { answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, answer(k)])) };
  },
});

describe("createJevProvider", () => {
  it("asks closed questions and maps answers to candidate IDs", async () => {
    const seen: Seen = {};
    const provider = createJevProvider({
      client: fakeClient((k) => {
        if (k === "c0_f0") return { noul: 0.93 }; // filter
        if (k.endsWith("_col0")) return { noul: 0.91 }; // value
        if (!isChoice(k)) return { noul: 0.02 };
        // `confidence` describes the distribution's shape; the value's own probability is what GridCue uses.
        if (k === "c0_val1") return { choice: "open", confidence: 0.4, probabilities: { none: 0.03, open: 0.97 } };
        return { choice: "none", confidence: 0.9, probabilities: { none: 0.9 } };
      }, seen),
    });
    const result = await provider.resolve(request);
    expect(result.clauses[0]).toMatchObject({
      values: [{ columnId: "status", valueId: "open", confidence: 0.97 }],
    });
    expect(result.clauses[0]?.families.filter((f) => f.confidence >= 0.5)).toEqual([{ id: "filter", confidence: 0.93 }]);
    expect(result.clauses[0]?.columns.filter((c) => c.confidence >= 0.5)).toEqual([{ id: "value", confidence: 0.91 }]);
    expect(result.clauses[0]?.families.length).toBe(request.candidates.families.length);
    expect(result.clauses[0]?.columns.map((c) => c.id).sort()).toEqual(request.candidates.columns.map((c) => c.id).sort());
    expect(JSON.stringify(seen)).not.toContain("tax_id");
    expect(seen.state).toMatchObject({ clauses: [{ text: "open accounts over $1m" }] });
    expect(JSON.stringify(seen.questions?.c0_col0)).toContain("`clauses[0].text`");
  });

  it("treats unknown choices as malformed", async () => {
    const provider = createJevProvider({
      client: fakeClient((k) => (k.includes("_val") ? { choice: "closed", confidence: 1 } : { noul: 0.1 })),
    });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_MALFORMED" });
  });

  it("treats a missing answer as malformed", async () => {
    const provider = createJevProvider({
      client: fakeClient((k) =>
        k === "c0_val1" ? undefined : isChoice(k) ? { choice: "none", probabilities: { none: 0.9 } } : { noul: 0.1 },
      ),
    });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_MALFORMED" });
  });

  it("treats a choice without its probability as malformed", async () => {
    const provider = createJevProvider({
      client: fakeClient((k) => (isChoice(k) ? { choice: "none", confidence: 0.9 } : { noul: 0.1 })),
    });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_MALFORMED" });
  });

  it("asks which column each literal applies to, offering only columns that fit", async () => {
    const seen: Seen = {};
    const provider = createJevProvider({
      client: fakeClient(
        (k) =>
          k === "c0_lit0"
            ? { choice: "value", probabilities: { none: 0.08, value: 0.92 } }
            : isChoice(k)
              ? { choice: "none", probabilities: { none: 0.9 } }
              : { noul: 0.1 },
        seen,
      ),
    });
    const result = await provider.resolve(request);
    expect(JSON.stringify(seen.questions?.c0_lit0)).toContain("Market value");
    expect(JSON.stringify(seen.questions?.c0_lit0)).not.toContain("Status");
    expect(seen.state).toMatchObject({ clauses: [{ literals: [{ kind: "currency", value: 1_000_000, comparator: "gt" }] }] });
    expect(result.clauses[0]?.literalColumns).toEqual([{ literalIndex: 0, columnId: "value", confidence: 0.92 }]);
  });

  it("skips questions about named values, but still asks about named columns", async () => {
    const text = "only open, sorted by market value";
    const input = normalize(text);
    const named = buildResolutionRequest(
      input,
      schema,
      caps,
      emptyViewState(["value", "status", "tax_id"]),
      matchMentions(input.clauses, schema.columns.filter(isExposed)),
    );
    const seen: Seen = {};
    const provider = createJevProvider({
      client: fakeClient((k) => (isChoice(k) ? { choice: "none", probabilities: { none: 0.9 } } : { noul: 0.1 }), seen),
    });
    const result = await provider.resolve(named);
    expect(Object.keys(seen.questions ?? {})).not.toContain("c0_val1");
    expect(Object.keys(seen.questions ?? {})).not.toContain("c0_col1");
    expect(Object.keys(seen.questions ?? {})).toContain("c1_col0");
    expect(result.clauses[0]?.columns.map((c) => c.id)).toEqual(["value"]);
  });

  it("pins the model it is tuned against unless the Host picks one", async () => {
    const answer = (k: string) => (isChoice(k) ? { choice: "none", probabilities: { none: 1 } } : { noul: 0 });
    const pinned: Seen = {};
    await createJevProvider({ client: fakeClient(answer, pinned) }).resolve(request);
    expect(pinned.model).toBe(DEFAULT_JEV_MODEL);
    expect(DEFAULT_JEV_MODEL).toBe("jev-1.13.0");
    const floating: Seen = {};
    await createJevProvider({ client: fakeClient(answer, floating), model: "jev-latest" }).resolve(request);
    expect(floating.model).toBe("jev-latest");
  });

  it("fits twelve Clauses within the default question budget", async () => {
    const twelve = buildResolutionRequest(
      normalize(Array.from({ length: 12 }, (_, i) => `sort by market value ${i}`).join("; ")),
      schema,
      caps,
      emptyViewState(["value", "status", "tax_id"]),
    );
    const provider = createJevProvider({
      client: fakeClient((k) => (isChoice(k) ? { choice: "none", probabilities: { none: 1 } } : { noul: 0 })),
    });
    await expect(provider.resolve(twelve)).resolves.toMatchObject({ clauses: { length: 12 } });
  });

  it("fans out role, change-type, and add-a-level questions for every part", async () => {
    const seen: Seen = {};
    const sorted = { ...emptyViewState(["value", "status", "tax_id"]), sorts: [{ columnId: "status", direction: "asc" as const }] };
    const req = buildResolutionRequest(normalize("also sort by market value"), schema, caps, sorted);
    const provider = createJevProvider({
      client: fakeClient((k) => {
        if (k === "c0_kind") return { choice: "sort", probabilities: { sort: 0.9, none: 0.1 } };
        if (k === "c0_role0_0") return { noul: 0.93 }; // value: sort
        if (k === "c0_adds") return { noul: 0.88 };
        return isChoice(k) ? { choice: "none", probabilities: { none: 1 } } : { noul: 0.05 };
      }, seen),
    });
    const [clause] = (await provider.resolve(req)).clauses;
    expect(JSON.stringify(seen.questions?.c0_role0_0)).toContain("sort the rows by the grid column `columns[0]`");
    expect(Object.keys(seen.questions ?? {})).toEqual(expect.arrayContaining(["c0_kind", "c0_adds"]));
    expect(seen.state).toMatchObject({ view: { sorts: [{ column: "Status", direction: "asc" }] } });
    expect(clause?.roles).toContainEqual({ columnId: "value", family: "sort", confidence: 0.93 });
    expect(clause).toMatchObject({ kind: { id: "sort", confidence: 0.9 }, adds: 0.88 });
    expect(Object.keys(seen.questions ?? {})).not.toContain("c0_multi");
  });

  it("asks which column is outer only when the part has reversal wording and names two columns", async () => {
    const keysFor = async (text: string) => {
      const input = normalize(text);
      const req = buildResolutionRequest(
        input,
        schema,
        caps,
        emptyViewState(["value", "status", "tax_id"]),
        matchMentions(input.clauses, schema.columns.filter(isExposed)),
      );
      const seen: Seen = {};
      await createJevProvider({
        client: fakeClient((k) => (isChoice(k) ? { choice: "none", probabilities: { none: 1 } } : { noul: 0.1 }), seen),
      }).resolve(req);
      return Object.keys(seen.questions ?? {}).filter((k) => k.includes("_outer"));
    };
    expect(await keysFor("sort by market value within status")).toEqual(["c0_outer0_1", "c0_outer1_0"]);
    expect(await keysFor("sort by market value and status")).toEqual([]);
  });

  it("wraps transport errors", async () => {
    const provider = createJevProvider({
      client: {
        systemOne: async () => {
          throw new Error("boom");
        },
      },
    });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
  });

  it("refuses oversized question sets", async () => {
    const provider = createJevProvider({ client: fakeClient(() => ({ noul: 0 })), maxQuestions: 3 });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_TOO_COMPLEX" });
  });

  it("keeps the TypeSafe SDK's own logging off by default, even when TYPESAFE_LOG_LEVEL asks for debug", async () => {
    vi.stubEnv("TYPESAFE_LOG_LEVEL", "debug");
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const fetchStub = vi.fn(
      async () => new Response(JSON.stringify({ answers: {} }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchStub);
    try {
      const provider = createJevProvider({ apiKey: "test-key" });
      await provider.resolve(request).catch(() => {});
      expect(fetchStub).toHaveBeenCalled();
      // At `debug`, the SDK logs full request and response bodies (the Utterance, column labels, aliases,
      // descriptions). A Host that leaves TYPESAFE_LOG_LEVEL unset should still get no SDK logging by default.
      expect(debugSpy).not.toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
