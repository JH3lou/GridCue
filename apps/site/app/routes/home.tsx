import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowRight, Eye, Lock, ShieldCheck, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { CopyButton } from "@/components/copy-button";
import { AskBar, type Suggestion } from "@/components/demo/ask-bar";
import { useWealthDemo } from "@/components/demo/use-wealth-demo";
import { WealthTable } from "@/components/demo/wealth-table";
import { baseOptions } from "@/lib/layout.shared";
import { gitConfig } from "@/lib/shared";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "GridCue: ask your data grid in plain language" },
    {
      name: "description",
      content:
        "Use natural language to get insights from complicated data, dense grids and tables. GridCue previews every view change and never touches your data. Open source, MIT.",
    },
  ];
}

// Every chip is checked against the Mock Provider before it ships (Site spec §5.1).
const HERO_SUGGESTIONS: Suggestion[] = [
  { label: "Taxable accounts over $1M, sort by concentration, highest first" },
  { label: "Roth IRAs grouped by rep" },
  { label: "Sort by market value, largest first" },
  { label: "Sell anything over 10%", refusal: true },
];

const EVIDENCE = "176 labelled live requests on a synthetic wealth schema, 0 wrong views (jev-1.13.0, Sept 2026)";

function Section({ id, eyebrow, title, children }: { id?: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto w-full max-w-5xl px-6 py-20">
      <p className="text-muted-foreground text-sm font-medium">{eyebrow}</p>
      <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-balance">{title}</h2>
      <div className="mt-10">{children}</div>
    </section>
  );
}

function Hero() {
  const { table, cue } = useWealthDemo(12);
  return (
    <section className="mx-auto grid w-full max-w-5xl gap-10 px-6 pt-20 pb-16">
      <div className="grid max-w-3xl gap-5">
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
          <span>MIT</span>
          <span aria-hidden>·</span>
          <span>Headless</span>
          <span aria-hidden>·</span>
          <span>Built for Jev</span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Ask your data a plain question. See the view that answers it.
        </h1>
        <p className="text-muted-foreground max-w-2xl text-lg text-pretty">
          Get to the insight in complicated data, dense grids and tables. GridCue previews every change and never touches your data.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            to="/demo"
            className="press bg-primary text-primary-foreground inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium"
          >
            Try the full demo <ArrowRight strokeWidth={2} className="size-4" />
          </Link>
          <span className="bg-muted inline-flex h-10 items-center gap-3 rounded-md px-3 font-mono text-sm">
            npm i gridcue <CopyButton text="npm i gridcue" />
          </span>
          <a
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors duration-150"
          >
            Star on GitHub
          </a>
        </div>
      </div>

      <div className="bg-card grid gap-4 rounded-xl p-4 shadow-[var(--shadow-raised)] sm:p-6">
        <AskBar controller={cue} suggestions={HERO_SUGGESTIONS} />
        <WealthTable table={table} controller={cue} maxRows={12} />
        <p className="text-muted-foreground text-xs">
          Running in your browser on the keyless Mock Provider, over synthetic accounts. No server, no key.
        </p>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: "You ask",
    body: "Type or dictate what you want to see: “Roth IRAs grouped by rep”. GridCue splits the request into parts and matches your app's own column names and values.",
  },
  {
    title: "GridCue previews exactly what will change",
    body: "The model only picks among choices your app declared. Code builds a checked plan and shows it line by line. Anything ambiguous becomes a question, never a guess.",
  },
  {
    title: "You apply, and can undo",
    body: "Nothing changes until you apply. The change is atomic, and one click puts the previous view back.",
  },
];

function HowItWorks() {
  return (
    <Section eyebrow="How it works" title="From a sentence to a view you can trust">
      <ol className="grid gap-6 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="scroll-step bg-card grid content-start gap-3 rounded-xl p-6 shadow-[var(--shadow-raised)]">
            <span className="text-muted-foreground font-mono text-sm tabular-nums">0{i + 1}</span>
            <h3 className="text-lg font-semibold">{step.title}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

const COMPARISON = [
  {
    aspect: "Who writes the grid state",
    llm: "The model generates it, and you hope the schema holds",
    gridcue: "Code writes it; the model only picks among closed choices",
  },
  {
    aspect: "Before anything changes",
    llm: "Applied directly, often while it streams in",
    gridcue: "A deterministic Preview; apply only on approval, with undo",
  },
  { aspect: "When it's unsure", llm: "It guesses", gridcue: "It asks one focused question, or declines" },
];

function WhyNotGenerate() {
  return (
    <Section eyebrow="The difference" title="Why the model doesn't write the filter">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-medium">An LLM writes the grid state</th>
              <th className="px-4 py-3 font-medium">GridCue</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.aspect} className="border-t">
                <th className="px-4 py-3 font-medium">{row.aspect}</th>
                <td className="text-muted-foreground px-4 py-3">{row.llm}</td>
                <td className="px-4 py-3">{row.gridcue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mt-4 text-sm">{EVIDENCE}.</p>
    </Section>
  );
}

const SAFETY = [
  { icon: ShieldCheck, title: "View-only", body: "Filters, sorts, groups and columns. It never edits a record." },
  { icon: Eye, title: "Preview before apply", body: "Every change is shown before it happens, and nothing applies without approval." },
  {
    icon: Lock,
    title: "Your rows stay yours",
    body: "Only column names and values you approve go to the model. Rows never leave your app.",
  },
  {
    icon: Undo2,
    title: "Undo, and no key in the browser",
    body: "Every change can be undone, and your provider key stays on your server.",
  },
];

function Safety() {
  return (
    <Section eyebrow="Safe by design" title="Built for grids where a wrong view costs something">
      <div className="grid gap-4 sm:grid-cols-2">
        {SAFETY.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-card flex gap-4 rounded-xl p-5 shadow-[var(--shadow-raised)]">
            <Icon strokeWidth={1.5} className="text-muted-foreground mt-0.5 size-5 shrink-0" />
            <div className="grid gap-1">
              <h3 className="font-semibold">{title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-8 border-t pt-6 text-sm">
        <span className="text-foreground font-medium">What GridCue is not:</span> not SQL, not a chatbot. It doesn't edit your data, and it
        doesn't compute answers; it arranges the view that shows them.
      </p>
    </Section>
  );
}

function Neutral() {
  return (
    <section className="border-y">
      <div className="text-muted-foreground mx-auto grid max-w-5xl gap-2 px-6 py-8 text-sm sm:grid-cols-2">
        <p>
          <span className="text-foreground font-medium">Providers:</span> Jev · Mock · your provider
        </p>
        <p>
          <span className="text-foreground font-medium">Grids:</span> TanStack Table · any array · AG Grid (next)
        </p>
      </div>
    </section>
  );
}

const DOMAIN_CODE = `defineSchema(columns, {
  rowNoun: "account",                    // "biggest accounts first" means the rows
  columns: {
    household: { entity: "household" },  // "largest households first": asks, never guesses
    registration_type: {
      valueGroups: [{ label: "Retirement", values: ["ira", "roth_ira"] }],
    },
  },
});

createJevProvider({ apiKey, strategy: "fan-out" }); // or "focused": fewer questions`;

function Domain() {
  return (
    <Section eyebrow="Fits your domain" title="Your words, your categories, a few lines of setup">
      <div className="grid items-start gap-8 md:grid-cols-[1fr_1.4fr]">
        <div className="text-muted-foreground grid gap-4 text-sm leading-relaxed">
          <p>
            Every app says things its own way. Three optional declarations teach GridCue your domain: what a row is, which columns name
            other records, and your own categories over a column's values.
          </p>
          <p>
            Choose how GridCue asks Jev: “fan-out” handles compound requests, nesting and “also”; “focused” asks fewer questions for simpler
            grids.
          </p>
        </div>
        <pre className="bg-muted overflow-x-auto rounded-xl p-5 text-xs leading-relaxed">
          <code>{DOMAIN_CODE}</code>
        </pre>
      </div>
    </Section>
  );
}

const QUICK_START = `import { createGridCue } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { GridCueBar } from "gridcue/react";
import { createTanStackAdapter, gridcueFilterFn, schemaFromTanStack } from "gridcue/tanstack-table";
import "gridcue/styles.css";

const table = useTable({ features, columns, data, defaultColumn: { filterFn: gridcueFilterFn } });
const [cue] = useState(() => {
  const schema = schemaFromTanStack(table);
  return createGridCue({ schema, adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
});

<GridCueBar controller={cue} />`;

function QuickStart() {
  return (
    <Section eyebrow="Quick start" title="A working command bar in five minutes, no key">
      <div className="grid gap-4">
        <div className="bg-muted flex items-center justify-between rounded-xl px-5 py-3 font-mono text-sm">
          npm i gridcue <CopyButton text="npm i gridcue" />
        </div>
        <pre className="bg-muted overflow-x-auto rounded-xl p-5 text-xs leading-relaxed">
          <code>{QUICK_START}</code>
        </pre>
        <p className="text-muted-foreground text-sm">
          The Mock Provider runs in the browser. When you're ready, turn on Jev behind your own endpoint.{" "}
          <Link to="/docs" className="text-foreground underline underline-offset-4">
            Read the docs
          </Link>
          .
        </p>
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="border-t">
      <div className="text-muted-foreground mx-auto grid max-w-5xl gap-4 px-6 py-10 text-sm">
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          <a href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`} className="hover:text-foreground">
            GitHub
          </a>
          <Link to="/docs" className="hover:text-foreground">
            Docs
          </Link>
          <Link to="/demo" className="hover:text-foreground">
            Demo
          </Link>
          <Link to="/changelog" className="hover:text-foreground">
            Changelog
          </Link>
          <span>MIT license</span>
        </nav>
        <p>GridCue is an independent open-source project, not affiliated with or endorsed by TypeSafe.</p>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="flex flex-col">
        <Hero />
        <HowItWorks />
        <WhyNotGenerate />
        <Safety />
        <Neutral />
        <Domain />
        <QuickStart />
      </div>
      <Footer />
    </HomeLayout>
  );
}
