// Finishes the static build for Cloudflare Workers static assets (ADR 0016): the 404 page at the path
// `not_found_handling: "404-page"` serves, a sitemap and robots.txt for every prerendered page, and checks that
// discovery assets exist and every internal link in those pages lands on something the build contains.
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
writeFileSync(
  join(OUT, "robots.txt"),
  `User-agent: *\nAllow: /\nContent-Signal: ai-train=no, search=yes, ai-input=no\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
);
console.log(`Post-build: 404.html, sitemap.xml (${pages.length} pages), robots.txt.`);

const exists = (path) => [path, `${path}/index.html`, `${path}.html`].some((p) => existsSync(join(OUT, p)));
const broken = new Map();
const checkLink = (target, from) => {
  let url;
  try {
    url = new URL(target, ORIGIN);
  } catch {
    broken.set(target, [...(broken.get(target) ?? []), from]);
    return;
  }

  if (url.origin !== ORIGIN) return;
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (!exists(path)) broken.set(target, [...(broken.get(target) ?? []), from]);
};

for (const asset of ["_headers", ".well-known/api-catalog"]) {
  if (!existsSync(join(OUT, asset))) {
    console.error(`Missing ${OUT}/${asset}.`);
    process.exit(1);
  }
}

let catalog;
try {
  catalog = JSON.parse(readFileSync(join(OUT, ".well-known/api-catalog"), "utf8"));
} catch {
  console.error(`Invalid JSON in ${OUT}/.well-known/api-catalog.`);
  process.exit(1);
}
if (!Array.isArray(catalog.linkset)) {
  console.error(`Missing linkset array in ${OUT}/.well-known/api-catalog.`);
  process.exit(1);
}
for (const [index, entry] of catalog.linkset.entries()) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.anchor !== "string") {
    console.error(`Invalid entry at linkset[${index}] in ${OUT}/.well-known/api-catalog.`);
    process.exit(1);
  }
  checkLink(entry.anchor, `.well-known/api-catalog linkset[${index}].anchor`);
  for (const [relation, links] of Object.entries(entry)) {
    if (relation === "anchor") continue;
    if (!Array.isArray(links)) {
      console.error(`Invalid ${relation} links at linkset[${index}] in ${OUT}/.well-known/api-catalog.`);
      process.exit(1);
    }
    for (const link of links) {
      if (!link || typeof link !== "object" || Array.isArray(link) || typeof link.href !== "string") {
        console.error(`Invalid ${relation} link at linkset[${index}] in ${OUT}/.well-known/api-catalog.`);
        process.exit(1);
      }
      checkLink(link.href, `.well-known/api-catalog linkset[${index}].${relation}`);
    }
  }
}

const headers = readFileSync(join(OUT, "_headers"), "utf8");
for (const [, target] of headers.matchAll(/<([^>]+)>/g)) checkLink(target, "_headers");
console.log("Post-build: agent discovery headers and API catalog are valid.");

// A broken internal link fails the build, so a renamed docs page can't strand the links that pointed at it.
for (const file of walk(OUT).filter((f) => f.endsWith(".html"))) {
  for (const [, href] of readFileSync(file, "utf8").matchAll(/href="(\/[^"#?]*)/g)) {
    if (href.startsWith("//")) continue;
    checkLink(href, relative(OUT, file));
  }
}
if (broken.size > 0) {
  console.error(`Broken internal links:\n${[...broken].map(([href, from]) => `  ${href} (in ${from.slice(0, 3).join(", ")})`).join("\n")}`);
  process.exit(1);
}
console.log("Post-build: every internal link resolves.");
