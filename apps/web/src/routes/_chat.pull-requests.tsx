import { createFileRoute, redirect } from "@tanstack/react-router";

// The source control page took over this address; links to it keep their filters.
export const Route = createFileRoute("/_chat/pull-requests")({
  beforeLoad: ({ location }) => {
    const params = new URLSearchParams(location.searchStr);
    params.set("tab", "pull-requests");
    throw redirect({ href: `/source-control?${params}`, replace: true });
  },
});
