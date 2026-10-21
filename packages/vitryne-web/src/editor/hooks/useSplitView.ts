// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useRef, useState } from "react";

/**
 * Which views show (2D, 3D or both; never neither) and, with both, the split between them: dragged
 * on the splitter, or toggled between a few ratios by a click.
 */
export function useSplitView() {
  const [show2d, setShow2d] = useState(true);
  const [show3d, setShow3d] = useState(true);
  const toggle2d = () => {
    if (show2d && !show3d) return;
    setShow2d((v) => !v);
  };
  const toggle3d = () => {
    if (show3d && !show2d) return;
    setShow3d((v) => !v);
  };

  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizing, setIsResizing] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const hasDragged = useRef(false);

  const toggleSplit = useCallback(() => {
    setSplitRatio((prev) => {
      if (Math.abs(prev - 0.5) < 0.05) return 0.35;
      if (prev < 0.45) return 0.65;
      return 0.5;
    });
  }, []);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    hasDragged.current = false;
    const container = workspaceRef.current;
    if (!container) return;

    const startX = e.clientX;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (Math.abs(moveEvent.clientX - startX) > 3) {
        hasDragged.current = true;
      }
      const rect = container.getBoundingClientRect();
      const x = moveEvent.clientX - rect.left;
      const minPx = 220;
      const maxPx = Math.max(minPx, rect.width - minPx);
      const clampedX = Math.max(minPx, Math.min(maxPx, x));
      setSplitRatio(clampedX / rect.width);
    };

    const onPointerUp = () => {
      setIsResizing(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, []);

  return {
    show2d,
    show3d,
    setShow2d,
    setShow3d,
    toggle2d,
    toggle3d,
    splitRatio,
    setSplitRatio,
    isResizing,
    workspaceRef,
    /** The splitter moved since the press: its click doesn't toggle. */
    hasDragged,
    toggleSplit,
    startResize,
  };
}

/** The views and their split, as the components drawing them get it (the workspace's ref aside). */
export type SplitView = Omit<ReturnType<typeof useSplitView>, "workspaceRef">;
