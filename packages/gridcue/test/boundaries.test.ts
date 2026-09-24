import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
/** Static `from` clauses, side-effect imports, dynamic imports, and `require` calls. */
const IMPORT_FORMS = [
  /^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm,
  /^\s*import\s+["']([^"']+)["']/gm,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const specifiersIn = (source: string) => IMPORT_FORMS.flatMap((form) => [...source.matchAll(form)].map((m) => m[1] ?? ""));
const importsOf = (file: string) => specifiersIn(readFileSync(file, "utf8"));

/** What each part of the package may import. Anything else is a boundary violation. */
const RULES: Record<string, RegExp> = {
  "index.ts": /^\.\/core\/[\w-]+$/,
  core: /^(\.\/[\w-]+|zod)$/,
  mock: /^(\.\.\/index|\.\.\/core\/[\w-]+)$/,
  react: /^(\.\.\/index|\.\/[\w-]+|react)$/,
  server: /^(\.\.\/index|\.\/[\w-]+|node:[\w/]+|@typesafe-ai\/sdk)$/,
  tanstack: /^\.\.\/index$/,
};

describe("package boundaries", () => {
  it("sees every import form", () => {
    const source = [
      'import a from "a";',
      'import { b } from "b";',
      'import type { C } from "c";',
      'export * from "d";',
      'import "e";',
      'const f = await import("f");',
      'const g = require("g");',
    ].join("\n");
    expect(specifiersIn(source).sort()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  for (const file of files(SRC)) {
    const area = relative(SRC, file).split("/")[0] ?? "";
    const rule = RULES[area];
    if (!rule) continue;
    it(`${relative(SRC, file)} imports only what ${area} may use`, () => {
      expect(importsOf(file).filter((spec) => !rule.test(spec))).toEqual([]);
    });
  }
});
