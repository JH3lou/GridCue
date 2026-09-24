// Proves gridcue/server resolves the right file for the runtime, in both directions.
//
// Node applies --conditions per process, so this script is run three separate times (see
// check:package in package.json), each with a different --conditions flag and a matching
// --expect flag telling it what that condition should do:
//   --conditions=browser                                     --expect=refuse  the browser stub must throw its refusal
//   --conditions=workerd --conditions=worker --conditions=browser  --expect=load  Cloudflare Workers must get the real module
//   --conditions=edge-light --conditions=browser             --expect=load  Vercel Edge must get the real module
//
// The workerd and edge-light checks add --conditions=browser too, matching what wrangler and the Vercel
// Edge Runtime actually request (wrangler resolves with workerd, worker, and browser together). Node picks
// the first exports key, in the order package.json lists them, that is in the requested set; testing
// --conditions=workerd alone would pass even with the "workerd" entry deleted, because it would just fall
// through to the identical "default" target. Only the combined, realistic condition set exercises the
// ordering that keeps "workerd"/"edge-light" ahead of "browser" in packages/gridcue/package.json.
const expect = process.argv.includes("--expect=load") ? "load" : "refuse";

if (expect === "refuse") {
  try {
    await import("gridcue/server");
    console.error("gridcue/server loaded under a browser-like condition. It must refuse.");
    process.exit(1);
  } catch (error) {
    if (!String(error).includes("runs only on a server")) throw error;
    console.log("gridcue/server refuses to load in browsers.");
  }
} else {
  const mod = await import("gridcue/server");
  if (typeof mod.createGridCueHandler !== "function") {
    console.error("gridcue/server loaded, but createGridCueHandler is not a function. It must resolve to the real server entry.");
    process.exit(1);
  }
  console.log("gridcue/server resolves to the real server entry on this edge runtime.");
}
