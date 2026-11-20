import { HomeLayout } from "fumadocs-ui/layouts/home";
import { useState } from "react";
import { AskBar } from "@/components/demo/ask-bar";
import { CompareStrategies } from "@/components/demo/compare-strategies";
import { DevPanel } from "@/components/demo/dev-panel";
import { SUGGESTIONS } from "@/components/demo/suggestions";
import { useWealthDemo } from "@/components/demo/use-wealth-demo";
import { WealthTable } from "@/components/demo/wealth-table";
import { baseOptions } from "@/lib/layout.shared";
import type { Route } from "./+types/demo";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Demo · GridCue" },
    { name: "description", content: "Try GridCue on 500 synthetic accounts, in your browser, with no key. Then compare Jev's strategies." },
  ];
}

const TABS = ["Try it", "Compare strategies"] as const;

export default function Demo() {
  const { table, cue, last } = useWealthDemo(500);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Try it");
  return (
    <HomeLayout {...baseOptions()}>
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-10">
        <header className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Try GridCue</h1>
          <p className="text-muted-foreground max-w-2xl">
            500 synthetic advisory accounts. Ask for the view you want, check the Preview, then apply or undo. This runs in your browser on
            the keyless Mock Provider, with no server and no account.
          </p>
        </header>
        <div role="tablist" aria-label="Demo" className="bg-muted flex w-fit gap-1 rounded-lg p-1 text-sm">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 font-medium ${tab === t ? "bg-background shadow-[var(--shadow-raised)]" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "Try it" ? (
          <div className="grid gap-4">
            <div className="bg-card grid gap-4 rounded-xl p-4 shadow-[var(--shadow-raised)] sm:p-6">
              <AskBar controller={cue} suggestions={SUGGESTIONS} />
            </div>
            <DevPanel
              controller={cue}
              last={last}
              viewState={() => {
                const { columnFilters, sorting, grouping, columnVisibility, columnOrder } = table.store.state;
                return { columnFilters, sorting, grouping, columnVisibility, columnOrder };
              }}
            />
            <WealthTable table={table} controller={cue} maxRows={100} />
          </div>
        ) : (
          <CompareStrategies />
        )}
      </div>
    </HomeLayout>
  );
}
