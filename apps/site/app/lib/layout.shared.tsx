import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // The owner's logo, traced to SVG, with a light-ink copy for dark mode (the orange stays).
      title: (
        <>
          <img src="/logo.svg" alt={appName} width={101} height={24} className="h-6 w-auto dark:hidden" />
          <img src="/logo-dark.svg" alt={appName} width={101} height={24} className="hidden h-6 w-auto dark:block" />
        </>
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
