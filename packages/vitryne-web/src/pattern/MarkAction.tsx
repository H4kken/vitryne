// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";

export function MarkAction(props: {
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium hover:bg-hover disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}
