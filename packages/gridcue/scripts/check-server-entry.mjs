// Run with --conditions=browser: importing gridcue/server must fail loudly in a browser build.
try {
  await import("gridcue/server");
  console.error("gridcue/server loaded under the browser condition. It must refuse.");
  process.exit(1);
} catch (error) {
  if (!String(error).includes("runs only on a server")) throw error;
  console.log("gridcue/server refuses to load in browsers.");
}
