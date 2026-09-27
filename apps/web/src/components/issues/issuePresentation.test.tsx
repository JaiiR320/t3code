import type { IssueDetailResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { issueThreadPrompt } from "./issuePresentation";

const detail = {
  repository: "team/project",
  issue: { number: 42, title: "Fix the parser", url: "https://github.com/team/project/issues/42" },
} as IssueDetailResult;

describe("issue thread prompt", () => {
  it("keeps the existing prompt when no template is configured", () => {
    expect(issueThreadPrompt(detail)).toBe(
      "Work on #42: Fix the parser\n\nhttps://github.com/team/project/issues/42\n\nRead the issue and its comments with `gh issue view 42 --repo team/project --comments` before making changes.",
    );
  });

  it("fills every supported placeholder and leaves unknown text alone", () => {
    expect(
      issueThreadPrompt(detail, "{{title}} #{{number}} {{url}} {{repository}} {{unknown}}"),
    ).toBe("Fix the parser #42 https://github.com/team/project/issues/42 team/project {{unknown}}");
  });
});
