// SPDX-License-Identifier: AGPL-3.0-or-later
// The right-click menu of the flat and 3D views: on a piece, take it out or move it outwards or
// inwards; on empty canvas, what the view offers (`empty`). The piece is picked by the press that
// opens the menu, so the menu reads the selection.

import {
  BringToFront,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FlipHorizontal2,
  FlipVertical2,
  SendToBack,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { MOD, SHIFT } from "@/lib/keys";
import type { PickedActions } from "../hooks/usePickedActions";

export type MenuEntry = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
};

export function CanvasMenu(props: {
  /** A piece is picked. */
  piece: boolean;
  actions: PickedActions;
  /** The flat view: pieces can be flipped. */
  flat?: boolean;
  /** For empty canvas (none: no menu there). */
  empty: MenuEntry[];
  children: ReactNode;
}) {
  const { piece, actions, empty, flat } = props;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        // Ctrl-click on a Mac is a right click, but Ctrl turns the view.
        onContextMenu={(e) => {
          if (e.ctrlKey || (!piece && !empty.length)) e.preventDefault();
        }}
      >
        {props.children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {piece ? (
          <>
            <ContextMenuItem onSelect={() => actions.copy()}>
              <Copy />
              Copy
              <ContextMenuShortcut>{MOD}C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!actions.canPaste}
              onSelect={() => actions.paste()}
            >
              <ClipboardPaste />
              Paste
              <ContextMenuShortcut>{MOD}V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => actions.duplicate()}>
              <CopyPlus />
              Duplicate
              <ContextMenuShortcut>{MOD}D</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => actions.remove()}>
              <Trash2 />
              Delete
              <ContextMenuShortcut>⌫</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            {flat && (
              <>
                <ContextMenuItem onSelect={() => actions.flip("horizontal")}>
                  <FlipVertical2 />
                  Flip horizontally
                  <ContextMenuShortcut>{SHIFT}H</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => actions.flip("vertical")}>
                  <FlipHorizontal2 />
                  Flip vertically
                  <ContextMenuShortcut>{SHIFT}V</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem
              disabled={!actions.canStep(1)}
              onSelect={() => actions.step(1)}
            >
              <BringToFront />
              Move outwards
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!actions.canStep(-1)}
              onSelect={() => actions.step(-1)}
            >
              <SendToBack />
              Move inwards
            </ContextMenuItem>
          </>
        ) : (
          <>
            {actions.canPaste && (
              <ContextMenuItem onSelect={() => actions.paste()}>
                <ClipboardPaste />
                Paste
                <ContextMenuShortcut>{MOD}V</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {empty.map((m) => (
              <ContextMenuItem key={m.label} onSelect={m.onSelect}>
                {m.icon}
                {m.label}
              </ContextMenuItem>
            ))}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
