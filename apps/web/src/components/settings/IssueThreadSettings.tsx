import { DEFAULT_ISSUE_THREAD_PROMPT_TEMPLATE } from "@t3tools/contracts/settings";

import { Textarea } from "../ui/textarea";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function IssueThreadSettingsSection() {
  const template = useScopedSettings((settings) => settings.issueThreadPromptTemplate);
  const mixed = useScopedSettingsMixed(["issueThreadPromptTemplate"]);
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsSection title="Issue threads">
      <SettingsRow
        serverScoped
        settingKeys={["issueThreadPromptTemplate"]}
        mixed={mixed}
        {...searchableSetting("issue-thread-prompt")}
        description="Fill the composer when you start a thread from a GitHub issue. Use {{number}}, {{title}}, {{url}}, and {{repository}}."
        resetAction={
          template !== DEFAULT_ISSUE_THREAD_PROMPT_TEMPLATE ? (
            <SettingResetButton
              label="issue thread prompt"
              onClick={() =>
                updateSettings({ issueThreadPromptTemplate: DEFAULT_ISSUE_THREAD_PROMPT_TEMPLATE })
              }
            />
          ) : null
        }
      >
        <div className="max-w-2xl pb-3.5">
          <Textarea
            key={mixed ? "mixed" : template}
            defaultValue={mixed ? "" : template}
            placeholder={
              mixed ? "Mixed. Enter a prompt to apply to all selected projects." : undefined
            }
            aria-label="GitHub issue thread prompt template"
            rows={5}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next && (mixed || next !== template)) {
                updateSettings({ issueThreadPromptTemplate: next });
              }
            }}
          />
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
