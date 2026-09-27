import { createFileRoute, redirect } from "@tanstack/react-router";

// The source control page took over this address; links to it keep their filters.
export const Route = createFileRoute("/_chat/pull-requests")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/source-control${location.searchStr}`, replace: true });
  },
});
