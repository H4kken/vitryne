// SPDX-License-Identifier: AGPL-3.0-or-later
import { Button } from "@/components/ui/button";
import { EngineSession, type EngineState } from "@/worker/session";
import { useFiles } from "../hooks/useFiles";
import { NoticeCard } from "./NoticeCard";

/**
 * What the editor has to say, as cards over the canvas: the engine's and the files' notices, a
 * conflict with another browser, a save that stopped, a drape that failed, and errors.
 */
export function NoticeCards(props: {
  session: EngineSession;
  engine: EngineState;
  files: ReturnType<typeof useFiles>;
  isAccount: boolean;
  onAccount: () => void;
  /** An error to show (a failed open or import, a refused edit). */
  message: string | null;
  onDismissMessage: () => void;
}) {
  const {
    session,
    engine,
    files,
    isAccount,
    onAccount,
    message,
    onDismissMessage,
  } = props;
  const stopped = files.saveStatus.kind === "stopped" ? files.saveStatus : null;
  return (
    <>
      {engine.notice && (
        <NoticeCard onDismiss={() => session.clearNotice()}>
          {engine.notice}
        </NoticeCard>
      )}
      {files.notice?.kind === "info" && (
        <NoticeCard onDismiss={() => files.dismissNotice()}>
          {files.notice.text}
        </NoticeCard>
      )}
      {files.conflict && (
        <NoticeCard tone="error">
          <span className="block">
            This project was changed in another browser since you opened it.
            Your latest changes aren't saved.
          </span>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={files.conflict.reload}>
              Open the other version
            </Button>
            {isAccount ? (
              <Button
                size="sm"
                variant="outline"
                onClick={files.conflict.saveCopy}
              >
                Keep mine as a copy
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void files.conflict?.keepMine()}
              >
                Keep mine
              </Button>
            )}
          </span>
        </NoticeCard>
      )}
      {stopped?.reason === "account" && (
        <NoticeCard tone="error">
          <span className="block">
            Your draft is the one project you can keep without an account.
            Create a free account to keep this one too.
          </span>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={onAccount}>
              Create an account
            </Button>
          </span>
        </NoticeCard>
      )}
      {stopped?.reason === "error" && (
        <NoticeCard tone="error">
          <span className="block">Not saved: {stopped.text}</span>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={files.retrySave}>
              Try again
            </Button>
          </span>
        </NoticeCard>
      )}
      {engine.drapeError && (
        <NoticeCard tone="error">
          The drape could not be built: {engine.drapeError}
        </NoticeCard>
      )}
      {message && (
        <NoticeCard tone="error" onDismiss={onDismissMessage}>
          {message}
        </NoticeCard>
      )}
    </>
  );
}
