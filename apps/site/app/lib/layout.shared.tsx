import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="grid size-5 grid-cols-2 gap-px overflow-hidden rounded-[5px] bg-foreground/80 p-px">
            <span className="bg-background" />
            <span className="bg-background" />
            <span className="bg-background" />
            <span className="bg-foreground" />
          </span>
          {appName}
        </span>
      ),
    },
    links: [
      { text: "Demo", url: "/demo" },
      { text: "Docs", url: "/docs" },
      { text: "Changelog", url: "/changelog" },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
