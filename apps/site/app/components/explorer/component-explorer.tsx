import type { Clarification, Preview } from "gridcue";
import { GridCueBar } from "gridcue/react";
import { type ReactNode, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { useWealthDemo } from "@/components/demo/use-wealth-demo";
import { WealthTable } from "@/components/demo/wealth-table";
import { ClarificationPrompt } from "@/components/gridcue/clarification-prompt";
import { CommandBar } from "@/components/gridcue/command-bar";
import { PreviewPanel } from "@/components/gridcue/preview-panel";
import registry from "../../../../../registry/registry.json";
import "gridcue/styles.css";

// Sources are read at build time, so the source dock and the props table can never drift from the code.
const REGISTRY_SOURCES = import.meta.glob<string>("../../../../../registry/registry/gridcue/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});
const GRID_CUE_BAR_SOURCE = import.meta.glob<string>("../../../../../packages/gridcue/src/react/grid-cue-bar.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});
const source = (file: string) =>
  Object.entries({ ...REGISTRY_SOURCES, ...GRID_CUE_BAR_SOURCE }).find(([path]) => path.endsWith(`/${file}`))?.[1] ?? "";

export interface Prop {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
  description?: string;
}

/**
 * Reads `export interface <name> { … }` and the component's destructured defaults from its source. The components'
 * props are simple (one member per line, optional JSDoc above), which is all this needs to handle.
 */
export const propsFrom = (code: string, interfaceName: string): Prop[] => {
  const body = code.match(new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  const defaults = new Map<string, string>();
  const signature = code.match(new RegExp(`\\(\\{([\\s\\S]*?)\\}:\\s*${interfaceName}\\)`))?.[1] ?? "";
  for (const m of signature.matchAll(/(\w+)\s*=\s*("[^"]*"|[^,\n]+)/g)) defaults.set(m[1] ?? "", (m[2] ?? "").trim());
  const props: Prop[] = [];
  let doc: string | undefined;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const comment = line.match(/^\/\*\*\s*(.*?)\s*\*\/$/);
    if (comment) {
      doc = comment[1];
      continue;
    }
    const member = line.match(/^(\w+)(\?)?:\s*(.+);$/);
    if (!member) continue;
    const name = member[1] ?? "";
    props.push({
      name,
      type: member[3] ?? "",
      optional: member[2] === "?",
      ...(defaults.has(name) ? { defaultValue: defaults.get(name) } : {}),
      ...(doc ? { description: doc } : {}),
    });
    doc = undefined;
  }
  return props;
};

const SAMPLE_PREVIEW: Preview = {
  lines: ["Filter Registration type to Roth IRA", "Group by Advisor"],
  text: "Filter Registration type to Roth IRA; group by Advisor. No records will be changed.",
};
const SAMPLE_CLARIFICATION: Clarification = {
  id: "c0.reading.household",
  prompt: "Did you mean households as a whole? GridCue can group by Household.",
  options: [
    { id: "group", label: "Group by Household" },
    { id: "column", label: "Use the Household column" },
  ],
  required: true,
};

function LiveBar({ kind }: { kind: "command-bar" | "grid-cue-bar" }) {
  const { table, cue } = useWealthDemo(6);
  return (
    <div className="grid w-full gap-4">
      {kind === "command-bar" ? <CommandBar controller={cue} /> : <GridCueBar controller={cue} />}
      <WealthTable table={table} controller={cue} maxRows={6} />
    </div>
  );
}

interface ComponentInfo {
  title: string;
  files: string[];
  propsInterface: string;
  propsFile: string;
  install: "registry" | "package";
  preview: () => ReactNode;
}

const COMPONENTS: Record<string, ComponentInfo> = {
  "command-bar": {
    title: "CommandBar",
    files: ["command-bar.tsx", "preview-panel.tsx", "clarification-prompt.tsx"],
    propsInterface: "CommandBarProps",
    propsFile: "command-bar.tsx",
    install: "registry",
    preview: () => <LiveBar kind="command-bar" />,
  },
  "preview-panel": {
    title: "PreviewPanel",
    files: ["preview-panel.tsx"],
    propsInterface: "PreviewPanelProps",
    propsFile: "preview-panel.tsx",
    install: "registry",
    preview: () => <PreviewPanel preview={SAMPLE_PREVIEW} onApply={() => {}} onCancel={() => {}} />,
  },
  "clarification-prompt": {
    title: "ClarificationPrompt",
    files: ["clarification-prompt.tsx"],
    propsInterface: "ClarificationPromptProps",
    propsFile: "clarification-prompt.tsx",
    install: "registry",
    preview: () => (
      <div className="grid gap-2">
        <p className="text-sm">{SAMPLE_CLARIFICATION.prompt}</p>
        <ClarificationPrompt clarification={SAMPLE_CLARIFICATION} onAnswer={() => {}} />
      </div>
    ),
  },
  "grid-cue-bar": {
    title: "GridCueBar",
    files: ["grid-cue-bar.tsx"],
    propsInterface: "GridCueBarProps",
    propsFile: "grid-cue-bar.tsx",
    install: "package",
    preview: () => <LiveBar kind="grid-cue-bar" />,
  },
};

const item = registry.items.find((i) => i.name === "command-bar");

/** The Components explorer (Site spec §5.5): live preview and source in the centre, install and props beside them. */
export function ComponentExplorer({ id }: { id: keyof typeof COMPONENTS }) {
  const info = COMPONENTS[id];
  const [file, setFile] = useState(info?.files[0] ?? "");
  if (!info) return null;
  const props = propsFrom(source(info.propsFile), info.propsInterface);
  const url = "https://gridcue.dev/r/command-bar.json";
  const installs =
    info.install === "registry"
      ? [`npx shadcn@latest add ${url}`, "npx shadcn@latest add @gridcue/command-bar"]
      : ["npm i gridcue", 'import { GridCueBar } from "gridcue/react";\nimport "gridcue/styles.css";'];

  return (
    <div className="not-prose grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 content-start gap-4">
        <div className="bg-muted/40 grid min-h-64 place-items-center rounded-xl border p-6">{info.preview()}</div>
        <div className="overflow-hidden rounded-xl border">
          <div role="tablist" aria-label="Source files" className="bg-muted/50 flex gap-1 border-b px-2 py-1.5 text-xs">
            {info.files.map((f) => (
              <button
                key={f}
                role="tab"
                type="button"
                aria-selected={file === f}
                onClick={() => setFile(f)}
                className={`rounded-md px-2 py-1 font-mono ${file === f ? "bg-background text-foreground shadow-[var(--shadow-raised)]" : "text-muted-foreground hover:text-foreground"}`}
              >
                {f}
              </button>
            ))}
            <span className="ml-auto flex items-center">
              <CopyButton text={source(file)} label={`Copy ${file}`} />
            </span>
          </div>
          <pre className="bg-background max-h-96 overflow-auto p-4 text-xs leading-relaxed">
            <code>{source(file)}</code>
          </pre>
        </div>
      </div>

      <aside className="grid content-start gap-6 text-sm">
        <section className="grid gap-2">
          <h3 className="font-semibold">Install</h3>
          {installs.map((cmd) => (
            <div key={cmd} className="bg-muted flex items-start justify-between gap-2 rounded-lg px-3 py-2 font-mono text-xs">
              <code className="break-all whitespace-pre-wrap">{cmd}</code>
              <CopyButton text={cmd} />
            </div>
          ))}
          {info.install === "registry" && (
            <p className="text-muted-foreground text-xs">
              The command bar installs with its Preview panel and Clarification prompt. For the <code>@gridcue</code> form, add{" "}
              <code>{`"registries": { "@gridcue": "https://gridcue.dev/r/{name}.json" }`}</code> to <code>components.json</code>.
            </p>
          )}
        </section>

        <section className="grid gap-2">
          <h3 className="font-semibold">Props</h3>
          <dl className="divide-y rounded-lg border text-xs">
            {props.map((p) => (
              <div key={p.name} className="grid gap-1 px-3 py-2.5">
                <dt className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono">
                  <span className="text-foreground font-medium">
                    {p.name}
                    {p.optional ? "?" : ""}
                  </span>
                  <span className="text-muted-foreground">{p.type}</span>
                </dt>
                <dd className="text-muted-foreground">
                  {p.defaultValue ? (
                    <>
                      Default <code className="font-mono">{p.defaultValue}</code>
                    </>
                  ) : p.optional ? (
                    "Optional"
                  ) : (
                    "Required"
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {info.install === "registry" && item && (
          <section className="grid gap-2">
            <h3 className="font-semibold">Built with</h3>
            <p className="text-muted-foreground">
              shadcn/ui {(item.registryDependencies ?? []).join(", ")}, and the <code>gridcue</code> package.
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}
