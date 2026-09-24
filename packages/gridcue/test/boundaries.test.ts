import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
const importsOf = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((m) => m[1] ?? "");

/** What each part of the package may import. Anything else is a boundary violation. */
const RULES: Record<string, RegExp> = {
  core: /^(\.\/[\w-]+|zod)$/,
  mock: /^(\.\.\/index|\.\.\/core\/[\w-]+)$/,
  react: /^(\.\.\/index|\.\/[\w-]+|react)$/,
  server: /^(\.\.\/index|\.\/[\w-]+|node:[\w/]+|@typesafe-ai\/sdk)$/,
  tanstack: /^\.\.\/index$/,
};

describe("package boundaries", () => {
  for (const file of files(SRC)) {
    const area = relative(SRC, file).split("/")[0] ?? "";
    const rule = RULES[area];
    if (!rule) continue;
    it(`${relative(SRC, file)} imports only what ${area} may use`, () => {
      expect(importsOf(file).filter((spec) => !rule.test(spec))).toEqual([]);
    });
  }
});
