// Fails if a browser bundle contains the canary key or any direct Jev code.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = ["gridcue-bundle-canary", "api.typesafe.ai", "TypeSafeClient"];
const ASSETS = /\.(js|mjs|html|css|json|map)$/;
const ROOTS = [
  { dir: "examples/vite/dist", files: ASSETS },
  // The Site is static and has no key at all (ADR 0016). Its docs quote server code, so names like TypeSafeClient
  // can't be forbidden there. Instead, the Jev provider's own error text (packages/gridcue/src/server/jev.ts), which
  // the docs never quote, marks the provider having been bundled for the browser.
  { dir: "apps/site/build/client", files: ASSETS, forbidden: ["gridcue-bundle-canary", "The Jev provider needs @typesafe-ai/sdk"] },
  { dir: "examples/next/.next/static", files: ASSETS },
  // Pages Next prerenders are served to browsers as-is. Route handlers' server code here is not.
  { dir: "examples/next/.next/server/app", files: /\.(html|rsc)$/ },
];

const missing = ROOTS.filter(({ dir }) => !existsSync(dir)).map(({ dir }) => dir);
if (missing.length > 0) {
  console.error(`Build the examples first. Missing: ${missing.join(", ")}`);
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const leaks = ROOTS.flatMap(({ dir, files, forbidden = FORBIDDEN }) =>
  walk(dir)
    .filter((file) => files.test(file))
    .flatMap((file) => forbidden.filter((s) => readFileSync(file, "utf8").includes(s)).map((s) => `${file}: ${s}`)),
);

if (leaks.length > 0) {
  console.error(`Browser bundles leak server-only material:\n${leaks.join("\n")}`);
  process.exit(1);
}
console.log(`Browser bundles clean (${ROOTS.map(({ dir }) => dir).join(", ")}).`);
