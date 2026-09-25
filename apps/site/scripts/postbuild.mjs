// Finishes the static build for Cloudflare Workers static assets (ADR 0006): the 404 page at the path
// `not_found_handling: "404-page"` serves, and a sitemap and robots.txt for every prerendered page.
import { copyFileSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ORIGIN = "https://gridcue.dev";
const OUT = "build/client";

if (!existsSync(join(OUT, "404/index.html"))) {
  console.error(`Missing ${OUT}/404/index.html. Run react-router build first.`);
  process.exit(1);
}
copyFileSync(join(OUT, "404/index.html"), join(OUT, "404.html"));

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const pages = walk(OUT)
  .filter((file) => file.endsWith("index.html"))
  .map((file) => `/${relative(OUT, file).replace(/index\.html$/, "")}`.replace(/\/$/, "") || "/")
  .filter((path) => path !== "/404")
  .sort();

writeFileSync(
  join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((path) => `  <url><loc>${ORIGIN}${path}</loc></url>`)
    .join("\n")}\n</urlset>\n`,
);
writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
console.log(`Post-build: 404.html, sitemap.xml (${pages.length} pages), robots.txt.`);
