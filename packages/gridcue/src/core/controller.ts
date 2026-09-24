import type { GridAdapter } from "./adapter";
import { type ConfidencePolicy, compile } from "./compile";
import { GridCueError, type Issue, isGridCueError } from "./errors";
import { type Mention, matchMentions } from "./mentions";
import { type NormalizedInput, normalize } from "./normalize";
import { screenRestricted } from "./policy";
import { type AuditEvent, type AuditPolicy, type Preview, renderPreview, toAuditEvent } from "./preview";
import type { VersionedViewState, ViewPlan, ViewSchema } from "./protocol";
import { buildResolutionRequest, type IntentProvider, ResolutionResult } from "./resolution";
import { isExposed } from "./schema";
import { type ApplicableViewPlan, validatePlan } from "./validate";

export type InteractionStatus = "idle" | "resolving" | "ready" | "needs_clarification" | "unsupported" | "applying" | "applied" | "error";

export interface ControllerState {
  status: InteractionStatus;
  utterance: string;
  plan: ViewPlan | null;
  preview: Preview | null;
  /** A short, user-facing message for the current status. */
  message: string | null;
  issues: Issue[];
  canUndo: boolean;
}

export interface GridCueOptions {
  adapter: GridAdapter;
  provider: IntentProvider;
  /** Defaults to the adapter's schema. */
  schema?: ViewSchema;
  confidence?: ConfidencePolicy;
  audit?: { onEvent: (event: AuditEvent) => void; policy?: AuditPolicy };
  maxUtteranceLength?: number;
  /**
   * How long a provider may take before GridCue gives up and returns to idle with the request kept. Default 8000 ms;
   * 0 turns the limit off. A live Jev call once hung for 78 s through the SDK's own retries (v1 grill, Q1).
   */
  providerTimeoutMs?: number;
}

export interface GridCueController {
  getState(): ControllerState;
  subscribe(listener: () => void): () => void;
  propose(text: string, options?: { channel?: ViewPlan["source"]["channel"] }): Promise<ViewPlan | null>;
  answer(clarificationId: string, optionId: string): ViewPlan | null;
  apply(): Promise<boolean>;
  cancel(): void;
  undo(): Promise<boolean>;
  dispose(): void;
}

/** Matches the largest request the resolution protocol accepts. */
const MAX_CLAUSES = 12;

const IDLE: ControllerState = { status: "idle", utterance: "", plan: null, preview: null, message: null, issues: [], canUndo: false };

const unsupportedMessage = (plan: ViewPlan): string => {
  const segment = plan.unsupportedSegments[0];
  if (!segment) return "That request can't be applied.";
  if (segment.category === "restricted_column") return "That request mentions a restricted column, so GridCue can't use it.";
  return `GridCue only changes how the table looks, so it can't do “${segment.text ?? "that"}”. Remove that part to continue.`;
};

/** The one object a Host creates to wire a grid to GridCue. */
export const createGridCue = (options: GridCueOptions): GridCueController => {
  const { adapter, provider } = options;
  const schema = options.schema ?? adapter.getSchema();
  const maxLength = options.maxUtteranceLength ?? 500;
  const providerTimeoutMs = options.providerTimeoutMs ?? 8000;
  let state: ControllerState = IDLE;
  let inflight: AbortController | null = null;
  let session: {
    input: NormalizedInput;
    resolution: ResolutionResult;
    base: VersionedViewState;
    channel: ViewPlan["source"]["channel"];
    answers: Record<string, string>;
    restricted: ReturnType<typeof screenRestricted>;
    mentions: Mention[];
  } | null = null;
  let applicable: ApplicableViewPlan | null = null;
  let undoEntry: { before: VersionedViewState; appliedRevision: string; plan: ViewPlan } | null = null;
  let ids = 0;
  const listeners = new Set<() => void>();

  const set = (next: Partial<ControllerState>) => {
    // A grid that can't be read can't be undone either; reading it must never break a state update.
    let revision: string | undefined;
    try {
      revision = adapter.getState().revision;
    } catch {
      revision = undefined;
    }
    state = { ...state, ...next, canUndo: undoEntry !== null && revision === undoEntry.appliedRevision };
    for (const l of listeners) l();
  };
  const audit = (plan: ViewPlan, outcome: Parameters<typeof toAuditEvent>[1], extra?: Parameters<typeof toAuditEvent>[3]) =>
    options.audit?.onEvent(toAuditEvent(plan, outcome, options.audit.policy, extra, options.confidence));

  const unsubscribeAdapter = adapter.subscribe(() => set({}));

  const present = (): ViewPlan => {
    if (!session) throw new Error("No active request.");
    const plan = compile({
      input: session.input,
      resolution: session.resolution,
      schema,
      state: session.base.state,
      baseRevision: session.base.revision,
      channel: session.channel,
      text: state.utterance,
      restricted: session.restricted,
      mentions: session.mentions,
      answers: session.answers,
      ...(options.confidence ? { confidence: options.confidence } : {}),
      newId: (prefix) => `${prefix}_${++ids}`,
    });
    applicable = null;
    const preview = plan.operations.length > 0 ? renderPreview(plan, schema) : null;
    if (plan.status === "ready") {
      const result = validatePlan(plan, {
        schema,
        capabilities: adapter.getCapabilities(),
        current: session.base,
        defaultState: adapter.getDefaultState(),
      });
      if (result.ok) {
        applicable = result.plan;
        set({ status: "ready", plan, preview, message: null, issues: [] });
      } else {
        set({
          status: "unsupported",
          plan,
          preview,
          message: result.issues[0]?.message ?? "That change isn't allowed here.",
          issues: result.issues,
        });
      }
    } else if (plan.status === "needs_clarification") {
      set({ status: "needs_clarification", plan, preview: null, message: plan.clarifications[0]?.prompt ?? null, issues: [] });
    } else {
      set({ status: "unsupported", plan, preview, message: unsupportedMessage(plan), issues: [] });
    }
    return plan;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async propose(text, { channel = "typed" } = {}) {
      const utterance = text.trim();
      if (!utterance) return null;
      inflight?.abort();
      if (utterance.length > maxLength) {
        set({
          ...IDLE,
          status: "error",
          utterance,
          message: `Keep requests under ${maxLength} characters.`,
          issues: [{ code: "INPUT_TOO_LONG", message: "Request too long." }],
        });
        return null;
      }
      const controller = new AbortController();
      inflight = controller;
      set({ ...IDLE, status: "resolving", utterance });
      // Past the time limit, abort and return to idle with the request kept. A newer request also aborts this one,
      // silently; only the limit reports anything.
      let expired = false;
      const timer =
        providerTimeoutMs > 0
          ? setTimeout(() => {
              expired = true;
              controller.abort();
            }, providerTimeoutMs)
          : undefined;
      const stopped = () => {
        if (expired) {
          set({
            ...IDLE,
            utterance,
            message: "That took too long. Try again.",
            issues: [{ code: "PROVIDER_TIMEOUT", message: "The provider took too long." }],
          });
        }
        return null;
      };
      // A provider that ignores the signal still can't hold the request past the limit.
      const abandoned = new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(new GridCueError("PROVIDER_TIMEOUT", "Aborted.")), { once: true }),
      );
      abandoned.catch(() => {});
      const input = normalize(utterance);
      if (input.clauses.length > MAX_CLAUSES) {
        clearTimeout(timer);
        set({
          status: "error",
          message: `Try fewer parts at once. GridCue handles up to ${MAX_CLAUSES} in one request.`,
          issues: [{ code: "INPUT_TOO_COMPLEX", message: "Too many clauses." }],
        });
        return null;
      }
      const base = adapter.getState();
      const restricted = screenRestricted(input, schema);
      const mentions =
        restricted.length === 0 ? matchMentions(input.clauses, schema.columns.filter(isExposed), { rowNoun: schema.rowNoun }) : [];
      try {
        let resolution: ResolutionResult = { clauses: [] };
        if (restricted.length === 0) {
          const request = buildResolutionRequest(input, schema, adapter.getCapabilities(), base.state, mentions);
          const raw = await Promise.race([provider.resolve(request, controller.signal), abandoned]);
          if (controller.signal.aborted) return stopped();
          const parsed = ResolutionResult.safeParse(raw);
          if (!parsed.success) throw new GridCueError("PROVIDER_MALFORMED", "The provider returned an unexpected response.");
          resolution = parsed.data;
        }
        session = { input, resolution, base, channel, answers: {}, restricted, mentions };
        return present();
      } catch (error) {
        if (controller.signal.aborted) return stopped();
        const code = isGridCueError(error) ? error.code : "PROVIDER_FAILED";
        // A provider (local or remote) can find a request too complex on its own terms, with its own limit,
        // so name no number here; the local clause-count check above states GridCue's own.
        const message =
          code === "PROVIDER_TOO_COMPLEX" ? "Try fewer parts at once." : "Couldn't interpret that request. The view hasn't changed.";
        set({
          status: "error",
          message,
          issues: [{ code, message: "Provider failed." }],
        });
        return null;
      } finally {
        clearTimeout(timer);
        if (inflight === controller) inflight = null;
      }
    },

    answer(clarificationId, optionId) {
      if (!session || state.status !== "needs_clarification" || !state.plan) return null;
      const clarification = state.plan.clarifications.find((c) => c.id === clarificationId);
      if (!clarification) return null;
      if (clarification.options && !clarification.options.some((o) => o.id === optionId)) return null;
      session.answers[clarificationId] = optionId;
      return present();
    },

    async apply() {
      const plan = applicable;
      if (state.status !== "ready" || !plan) return false;
      set({ status: "applying" });
      const failed = (message: string) => {
        audit(plan, "failed", { errorCode: "ADAPTER_FAILED" });
        set({ status: "error", message, issues: [{ code: "ADAPTER_FAILED", message }] });
        return false;
      };
      // Every adapter call sits inside a try, so a throwing adapter can never leave the controller on "applying".
      let before: VersionedViewState;
      let recheck: ReturnType<typeof validatePlan>;
      try {
        before = adapter.getState();
        recheck = validatePlan(plan, {
          schema,
          capabilities: adapter.getCapabilities(),
          current: before,
          defaultState: adapter.getDefaultState(),
        });
      } catch {
        return failed("The grid couldn't apply that change. Nothing was changed.");
      }
      if (!recheck.ok) {
        audit(plan, "rejected", { errorCode: recheck.issues[0]?.code ?? "PLAN_INVALID" });
        set({ status: "error", message: "The view changed since this preview. Preview the request again.", issues: recheck.issues });
        return false;
      }
      let result: Awaited<ReturnType<typeof adapter.apply>>;
      try {
        result = await adapter.apply(recheck.plan);
      } catch {
        // A write that throws part-way may have changed the grid: put the previous view back.
        let restored = false;
        try {
          restored = (await adapter.restore(before)).ok;
        } catch {
          restored = false;
        }
        return failed(
          restored ? "The grid couldn't apply that change. The previous view is back." : "The grid couldn't apply that change.",
        );
      }
      if (!result.ok) {
        audit(plan, "failed", { errorCode: result.code });
        set({
          status: "error",
          message: "The grid couldn't apply that change. Nothing was changed.",
          issues: [{ code: result.code, message: result.message }],
        });
        return false;
      }
      undoEntry = { before, appliedRevision: result.state.revision, plan };
      applicable = null;
      audit(plan, "applied", { newRevision: result.state.revision });
      set({ status: "applied", message: "View updated." });
      return true;
    },

    cancel() {
      inflight?.abort();
      inflight = null;
      if (state.plan && state.status !== "applied") audit(state.plan, "cancelled");
      applicable = null;
      session = null;
      set({ ...IDLE, utterance: state.utterance });
    },

    async undo() {
      const entry = undoEntry;
      if (!entry) return false;
      let current: VersionedViewState;
      try {
        current = adapter.getState();
      } catch {
        set({
          status: "error",
          message: "The grid couldn't undo that change.",
          issues: [{ code: "ADAPTER_FAILED", message: "The grid couldn't undo that change." }],
        });
        return false;
      }
      if (current.revision !== entry.appliedRevision) {
        undoEntry = null;
        set({
          status: "error",
          message: "The view changed after that update, so undo would erase newer changes.",
          issues: [{ code: "PLAN_STALE_REVISION", message: "Stale undo." }],
        });
        return false;
      }
      let result: Awaited<ReturnType<typeof adapter.restore>>;
      try {
        result = await adapter.restore(entry.before);
      } catch {
        undoEntry = null;
        set({
          status: "error",
          message: "The grid couldn't undo that change.",
          issues: [{ code: "ADAPTER_FAILED", message: "The grid couldn't undo that change." }],
        });
        return false;
      }
      undoEntry = null;
      if (!result.ok) {
        set({ status: "error", message: "Couldn't undo that change.", issues: [{ code: result.code, message: result.message }] });
        return false;
      }
      audit(entry.plan, "undone", { newRevision: result.state.revision });
      set({ ...IDLE, utterance: state.utterance, message: "Change undone." });
      return true;
    },

    dispose() {
      inflight?.abort();
      unsubscribeAdapter();
      listeners.clear();
    },
  };
};
