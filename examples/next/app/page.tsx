import { AccountsView } from "./accounts-view";

// The rows' dates are worked out from today, so the page is rendered for each request and never at build time. The
// server passes its clock on, and the browser builds the same rows from it.
export const dynamic = "force-dynamic";

export default function Page() {
  return <AccountsView now={new Date().toISOString()} />;
}
