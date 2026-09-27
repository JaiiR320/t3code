import { createFileRoute, redirect } from "@tanstack/react-router";

// The issues prototype's address, now the source control page's issues tab.
export const Route = createFileRoute("/_chat/issues")({
  beforeLoad: ({ location }) => {
    const search = location.search as Record<string, unknown>;
    const params = new URLSearchParams({ tab: "issues" });
    if (search.remote === "upstream") params.set("remote", "upstream");
    if (search.state === "closed") params.set("issueState", "closed");
    throw redirect({ href: `/source-control?${params}`, replace: true });
  },
});
