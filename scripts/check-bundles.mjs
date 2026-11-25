// Fails if a browser bundle contains the canary key, any direct Jev code, the Query Check, or the Next.js example's
// server-only Data Query.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The Query Check's own error text (packages/gridcue/src/testing/index.ts). `gridcue/testing` is for tests, and no
// client bundle may import it.
const QUERY_CHECK = "queryCheck takes options after the schema";
const FORBIDDEN = ["gridcue-bundle-canary", "api.typesafe.ai", "TypeSafeClient", QUERY_CHECK];
// The paged example's Data Query runs only on the server: SQLite and its table (examples/next/app/api/rows/query.ts).
const NEXT_FORBIDDEN = [...FORBIDDEN, "node:sqlite", "DatabaseSync", "grid_rows"];
const ASSETS = /\.(js|mjs|html|css|json|map)$/;
const ROOTS = [
  { dir: "examples/vite/dist", files: ASSETS },
  // The AG Grid example has no server at all: the Mock Provider runs in the browser.
  { dir: "examples/ag-grid/dist", files: ASSETS },
  // The Site is static and has no key at all (ADR 0016). Its docs quote server code, so names like TypeSafeClient
  // can't be forbidden there. Instead, the Jev provider's own error text (packages/gridcue/src/server/jev.ts), which
  // the docs never quote, marks the provider having been bundled for the browser.
  {
    dir: "apps/site/build/client",
    files: ASSETS,
    forbidden: ["gridcue-bundle-canary", "The Jev provider needs @typesafe-ai/sdk", QUERY_CHECK],
  },
  { dir: "examples/next/.next/static", files: ASSETS, forbidden: NEXT_FORBIDDEN },
  // Pages Next prerenders are served to browsers as-is. Route handlers' server code here is not.
  { dir: "examples/next/.next/server/app", files: /\.(html|rsc)$/, forbidden: NEXT_FORBIDDEN },
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
