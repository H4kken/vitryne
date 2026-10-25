// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";
import { ProjectGrid } from "@/cloud/ProjectGrid";
import type { Cloud } from "@/cloud/useCloud";
import type { Example } from "../examples";
import { CloudButton } from "../layout/CloudButton";
import { HelpMenu } from "../layout/HelpMenu";
import { ThemeMenu } from "../layout/ThemeMenu";
import { NoticeCard } from "../layout/NoticeCard";
import { StartScreen } from "./StartScreen";

/** The start screen with the person's account, projects and what went wrong, as `/` shows it. */
export function StartPage(props: {
  cloud: Cloud;
  examples: Example[];
  busy: string | null;
  /** The anonymous user's draft, their one project. */
  hasDraft: boolean;
  onPreset: (e: Example) => void;
  onScratch: () => void;
  onImport: () => void;
  dropProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  onOpenFolder: (() => void) | null;
  onAccount: () => void;
  onOpenProject: (id: string) => void;
  recoveryBanner: ReactNode;
  message: string | null;
  onDismissMessage: () => void;
}) {
  const { cloud, hasDraft, onAccount, message } = props;
  return (
    <StartScreen
      examples={props.examples}
      busy={props.busy}
      onPreset={props.onPreset}
      onScratch={props.onScratch}
      onImport={props.onImport}
      dropProps={props.dropProps}
      onOpenFolder={props.onOpenFolder}
      account={
        <>
          <ThemeMenu />
          <HelpMenu privacyPolicy={cloud.config.privacyPolicy} />
          <CloudButton user={cloud.user} onClick={onAccount} />
        </>
      }
      projects={
        // Nobody signed in yet: nothing saved, so no list to wait for.
        !cloud.user || cloud.projects ? (
          <ProjectGrid
            cloud={cloud}
            projects={cloud.projects ?? []}
            title={hasDraft ? "Your draft" : "Your projects"}
            note={
              hasDraft && (
                <p className="text-body-text m-0 text-[15px]">
                  Without an account you keep one project.{" "}
                  <button
                    type="button"
                    onClick={onAccount}
                    className="text-foreground font-semibold underline underline-offset-4"
                  >
                    Create a free account
                  </button>{" "}
                  to keep more and open them anywhere.
                </p>
              )
            }
            busy={!!props.busy}
            onOpen={props.onOpenProject}
          />
        ) : null
      }
      banner={
        <>
          {props.recoveryBanner}
          {message && (
            <div className="mx-auto mt-2 w-[calc(100%-64px)] max-w-[1056px]">
              <NoticeCard tone="error" onDismiss={props.onDismissMessage}>
                {message}
              </NoticeCard>
            </div>
          )}
        </>
      }
    />
  );
}
