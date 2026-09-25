import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { baseOptions } from "@/lib/layout.shared";
import changelog from "../../../../packages/gridcue/CHANGELOG.md?raw";
import type { Route } from "./+types/changelog";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Changelog · GridCue" }, { name: "description", content: "What changed in each GridCue release." }];
}

/** Renders the package's CHANGELOG.md: headings, bold, code and lists, which is all it uses. */
const inline = (text: string): ReactNode[] => {
  let offset = 0;
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part) => {
    const key = offset;
    offset += part.length;
    if (part.startsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`"))
      return (
        <code key={key} className="bg-muted rounded px-1 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
};

export default function Changelog() {
  const blocks = changelog.split("\n");
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length === 0) return;
    out.push(
      <ul key={out.length} className="grid list-disc gap-1 pl-5">
        {list.map((item) => (
          <li key={item}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const line of blocks) {
    if (line.startsWith("- ")) list.push(line.slice(2));
    else {
      flush();
      if (line.startsWith("# ")) continue;
      if (line.startsWith("## "))
        out.push(
          <h2 key={out.length} className="mt-8 text-xl font-semibold">
            {line.slice(3)}
          </h2>,
        );
      else if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>);
    }
  }
  flush();
  return (
    <HomeLayout {...baseOptions()}>
      <div className="mx-auto grid w-full max-w-3xl gap-4 px-6 py-12 leading-relaxed">
        <h1 className="text-3xl font-semibold tracking-tight">Changelog</h1>
        {out}
      </div>
    </HomeLayout>
  );
}
