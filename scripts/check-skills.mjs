// Checks the installable agent skill (skills/) and the maintainer skills (.agents/skills/) before they ship:
// frontmatter, hidden maintainer skills, docs links that point at real pages, and the plugin version.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const problems = [];
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const frontmatter = (file) => {
  const match = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return undefined;
  const field = (name) => match[1].match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.replace(/^"(.*)"$/, "$1");
  return { name: field("name"), description: field("description"), internal: /^metadata:\n\s+internal:\s*true\s*$/m.test(match[1]) };
};

// The public skills: a name matching the folder, and a description agents can match on.
for (const dir of readdirSync("skills")) {
  const file = join("skills", dir, "SKILL.md");
  const meta = existsSync(file) ? frontmatter(file) : undefined;
  if (!meta) problems.push(`${file}: missing, or no frontmatter`);
  else {
    if (meta.name !== dir) problems.push(`${file}: name "${meta.name}" should be "${dir}"`);
    if (!meta.description) problems.push(`${file}: no description`);
    else if (meta.description.length >= 1024)
      problems.push(`${file}: description is ${meta.description.length} characters; keep it under 1024`);
    if (meta.internal) problems.push(`${file}: a public skill must not be internal`);
  }
}

// Maintainer skills stay out of what the skills CLI offers to users.
for (const dir of readdirSync(".agents/skills")) {
  const file = join(".agents/skills", dir, "SKILL.md");
  if (existsSync(file) && !frontmatter(file)?.internal) problems.push(`${file}: a maintainer skill needs metadata.internal: true`);
}

// Every docs link in a skill names a page the Site has, so renaming a page fails here instead of breaking the skill.
const DOCS = "apps/site/content/docs";
const pageExists = (path) => {
  const p = path.replace(/\/$/, "");
  return [`${p}.mdx`, `${p}/index.mdx`].some((f) => existsSync(join(DOCS, f))) || (p === "" && existsSync(join(DOCS, "index.mdx")));
};
for (const file of walk("skills").filter((f) => f.endsWith(".md"))) {
  const text = readFileSync(file, "utf8");
  for (const [, path] of text.matchAll(/https:\/\/gridcue\.dev\/docs\/?([a-z0-9/-]*)/g)) {
    if (!pageExists(path)) problems.push(`${file}: no docs page for https://gridcue.dev/docs/${path}`);
  }
  for (const [, path] of text.matchAll(/https:\/\/gridcue\.dev\/llms\.mdx\/docs\/([a-z0-9/-]+)\/content\.md/g)) {
    if (!pageExists(path)) problems.push(`${file}: no docs page for the Markdown of ${path}`);
  }
  for (const [, target] of text.matchAll(/\]\((references\/[^)]+)\)/g)) {
    if (!existsSync(join(file.replace(/\/[^/]+$/, ""), target))) problems.push(`${file}: links to missing ${target}`);
  }
}

// The Claude Code plugin: both manifests parse, and the plugin's version is the package's.
const json = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problems.push(`${file}: ${error.message}`);
    return undefined;
  }
};
const plugin = json(".claude-plugin/plugin.json");
json(".claude-plugin/marketplace.json");
const version = json("packages/gridcue/package.json")?.version;
if (plugin && plugin.version !== version)
  problems.push(`.claude-plugin/plugin.json: version ${plugin.version} should be the package's ${version}`);

if (problems.length > 0) {
  console.error(`Skill checks failed:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("Skills OK: frontmatter, hidden maintainer skills, docs links, and plugin version.");
