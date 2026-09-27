import { createFileRoute, redirect } from "@tanstack/react-router";

// The issues prototype's address, now the source control page's issues tab.
export const Route = createFileRoute("/_chat/issues")({
  beforeLoad: ({ location }) => {
    const search = location.search as Record<string, unknown>;
    const params = new URLSearchParams();
    if (search.remote === "upstream") params.set("remote", "upstream");
    if (search.state === "closed") params.set("issueState", "closed");
    const query = params.toString();
    throw redirect({ href: `/source-control${query ? `?${query}` : ""}`, replace: true });
  },
});
