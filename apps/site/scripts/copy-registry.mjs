// Serves the Component Registry from the Site at /r (Site spec §5.6): copies `shadcn build` output into public/r.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const from = new URL("../../../registry/dist/r/", import.meta.url);
const to = new URL("../public/r/", import.meta.url);
if (!existsSync(from)) {
  console.error("registry/dist/r is missing: run `pnpm registry:build` first.");
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log("Copied the registry to public/r.");
