import type { ReactNode } from "react";
import "gridcue/styles.css";
import "./page.css";

export const metadata = { title: "GridCue · Next.js example" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
