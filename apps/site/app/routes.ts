import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("demo", "routes/demo.tsx"),
  route("changelog", "routes/changelog.tsx"),
  route("blog", "routes/blog.tsx"),
  route("docs/*", "routes/docs.tsx"),
  route("api/search", "routes/search.ts"),

  // LLM integration:
  route("llms.txt", "llms/index.ts"),
  route("llms-full.txt", "llms/full.ts"),
  route("llms.mdx/docs/*", "llms/mdx.ts"),

  // Prerendered as 404.html for static hosting.
  route("404", "routes/not-found.tsx", { id: "not-found-page" }),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
