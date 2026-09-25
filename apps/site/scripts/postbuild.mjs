// Finishes the static build for Cloudflare Workers static assets (ADR 0016): the 404 page at the path
// `not_found_handling: "404-page"` serves, a sitemap and robots.txt for every prerendered page, and a check that
// every internal link in those pages lands on something the build contains.
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

// A broken internal link fails the build, so a renamed docs page can't strand the links that pointed at it.
const exists = (path) => [path, `${path}/index.html`, `${path}.html`].some((p) => existsSync(join(OUT, p)));
const broken = new Map();
for (const file of walk(OUT).filter((f) => f.endsWith(".html"))) {
  for (const [, href] of readFileSync(file, "utf8").matchAll(/href="(\/[^"#?]*)/g)) {
    const path = href.replace(/\/$/, "");
    if (path === "" || href.startsWith("//") || exists(path)) continue;
    broken.set(href, [...(broken.get(href) ?? []), relative(OUT, file)]);
  }
}
if (broken.size > 0) {
  console.error(`Broken internal links:\n${[...broken].map(([href, from]) => `  ${href} (in ${from.slice(0, 3).join(", ")})`).join("\n")}`);
  process.exit(1);
}
console.log("Post-build: every internal link resolves.");
