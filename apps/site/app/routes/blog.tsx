import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";
import type { Route } from "./+types/blog";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Blog · GridCue" }, { name: "description", content: "Notes on building GridCue." }];
}

// Reserved for the launch post, "Why we don't let the model write the filter" (product brief §6).
export default function Blog() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="mx-auto grid w-full max-w-3xl gap-4 px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Blog</h1>
        <p className="text-muted-foreground">The first post, “Why we don't let the model write the filter”, is on its way.</p>
      </div>
    </HomeLayout>
  );
}
