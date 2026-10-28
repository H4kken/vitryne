// SPDX-License-Identifier: AGPL-3.0-or-later
// The right-click menu of the flat and 3D views: on a piece, take it out or move it outwards or
// inwards; on empty canvas, what the view offers (`empty`). The piece is picked by the press that
// opens the menu, so the menu reads the selection.

import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { MOD } from "@/lib/keys";
import type { PickedActions } from "../hooks/usePickedActions";

export type MenuEntry = { label: string; onSelect: () => void };

export function CanvasMenu(props: {
  /** A piece is picked. */
  piece: boolean;
  actions: PickedActions;
  /** For empty canvas (none: no menu there). */
  empty: MenuEntry[];
  children: ReactNode;
}) {
  const { piece, actions, empty } = props;
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
            <ContextMenuItem
              disabled={!actions.canStep(1)}
              onSelect={() => actions.step(1)}
            >
              Move outwards
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!actions.canStep(-1)}
              onSelect={() => actions.step(-1)}
            >
              Move inwards
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => actions.copy()}>
              Copy
              <ContextMenuShortcut>{MOD}C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!actions.canPaste}
              onSelect={() => actions.paste()}
            >
              Paste
              <ContextMenuShortcut>{MOD}V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => actions.remove()}
            >
              Delete
              <ContextMenuShortcut>⌫</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        ) : (
          <>
            {actions.canPaste && (
              <ContextMenuItem onSelect={() => actions.paste()}>
                Paste
                <ContextMenuShortcut>{MOD}V</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {empty.map((m) => (
              <ContextMenuItem key={m.label} onSelect={m.onSelect}>
                {m.label}
              </ContextMenuItem>
            ))}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
