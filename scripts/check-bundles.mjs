// Fails if a browser bundle contains the canary key or any direct Jev code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = ["gridcue-bundle-canary", "api.typesafe.ai", "TypeSafeClient"];
const ROOTS = ["examples/vite/dist", "examples/next/.next/static"];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const leaks = ROOTS.flatMap(walk)
  .filter((file) => /\.(js|mjs|html|css|json|map)$/.test(file))
  .flatMap((file) => FORBIDDEN.filter((s) => readFileSync(file, "utf8").includes(s)).map((s) => `${file}: ${s}`));

if (leaks.length > 0) {
  console.error(`Browser bundles leak server-only material:\n${leaks.join("\n")}`);
  process.exit(1);
}
console.log(`Browser bundles clean (${ROOTS.join(", ")}).`);
