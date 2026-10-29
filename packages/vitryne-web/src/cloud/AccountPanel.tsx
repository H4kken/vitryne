// SPDX-License-Identifier: AGPL-3.0-or-later

import { Download, LogOut } from "lucide-react";
import { AccountAvatar } from "./AccountAvatar";
import type { Usage } from "./backend";
import { formatBytes } from "./formatBytes";

/** A signed-in person: who, how much storage, and the things to do with the account. */
export function AccountPanel(props: {
  email: string;
  /** Google's picture for the account, if it has one. */
  avatarUrl?: string | null;
  usage: Usage | null;
  working: string | null;
  onExport: () => void;
  onSignOut: () => void;
  onDelete: () => void;
}) {
  const { usage, working } = props;
  const rows = [
    { label: "Download all my data", icon: <Download />, run: props.onExport },
    { label: "Sign out", icon: <LogOut />, run: props.onSignOut },
  ];
  return (
    <div className="flex flex-col gap-4 text-[15px]">
      <div className="flex items-center gap-3">
        <AccountAvatar
          email={props.email}
          avatarUrl={props.avatarUrl}
          className="size-11 text-lg"
        />
        <div className="min-w-0">
          <p className="m-0 truncate font-semibold">{props.email}</p>
          <p className="text-muted-foreground m-0 text-[13px]">Free account</p>
        </div>
      </div>
      {usage && (
        <div className="flex flex-col gap-1.5">
          <div className="bg-secondary h-2 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full"
              style={{
                width: `${Math.min(100, (100 * usage.usedBytes) / Math.max(1, usage.quotaBytes))}%`,
              }}
            />
          </div>
          <span className="text-muted-foreground text-[13px]">
            {formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)}{" "}
            used · {usage.projects} project{usage.projects === 1 ? "" : "s"}
          </span>
        </div>
      )}
      <div className="border-border overflow-hidden rounded-xl border">
        {rows.map((r) => (
          <button
            key={r.label}
            type="button"
            disabled={!!working}
            className="hover:bg-secondary border-border flex w-full items-center gap-3 px-3.5 py-3 text-left text-[15px] not-first:border-t disabled:opacity-50"
            onClick={r.run}
          >
            <span className="grow">{r.label}</span>
            <span className="text-muted-foreground">{r.icon}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="text-danger self-start text-[13px] underline underline-offset-4"
        onClick={props.onDelete}
      >
        Delete my account…
      </button>
      {working && (
        <p className="text-muted-foreground m-0 text-sm">{working}…</p>
      )}
    </div>
  );
}
