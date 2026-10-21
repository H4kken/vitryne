// SPDX-License-Identifier: AGPL-3.0-or-later
// The view of the flat pieces: its size, the box it shows (fitted to the pieces, or where the
// person panned or zoomed to, per garment), wheel zoom around the cursor, and pointer positions
// in pattern millimetres (y up).

import { useEffect, useRef, useState, type RefObject } from "react";
import { type Box, type P } from "../geometry";
import { LABEL_GAP_MM } from "./constants";

function fit(box: Box, aspect: number, margin = 60): Box {
  let w = box.maxX - box.minX + 2 * margin;
  let h = box.maxY - box.minY + 2 * margin;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return {
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minY: cy - h / 2,
    maxY: cy + h / 2,
  };
}

export function usePanelView(o: {
  host: RefObject<HTMLDivElement | null>;
  garmentId: string | undefined;
  /** The pieces' box (pattern coordinates, y up). */
  layoutBox: Box;
}) {
  const { host, garmentId } = o;
  const [size, setSize] = useState({ w: 1, h: 1 });
  // The view box the user panned or zoomed to, for one garment (another file frames itself).
  const [userView, setUserView] = useState<{
    garment: string | undefined;
    box: Box;
  } | null>(null);
  const view = userView && userView.garment === garmentId ? userView.box : null;
  const setView = (box: Box | null) =>
    setUserView(box ? { garment: garmentId, box } : null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [host]);

  // The same box in SVG coordinates (y down), with room for the labels.
  const all = {
    minX: o.layoutBox.minX,
    maxX: o.layoutBox.maxX,
    minY: -o.layoutBox.maxY,
    maxY: -o.layoutBox.minY + LABEL_GAP_MM,
  };
  const aspect = size.w / size.h;
  // Room around the pieces for the status pill above and the hint and zoom below.
  const home = fit(
    all,
    aspect,
    0.12 * Math.max(all.maxX - all.minX, (all.maxY - all.minY) * aspect),
  );
  // Keep the aspect of the panel (the view box may come from another size).
  const vb = fit(view ?? home, aspect, 0);
  const mmPerPx = (vb.maxX - vb.minX) / size.w;

  /** Scales the view box by `k` (< 1 zooms in) around a point given as a fraction of the panel. */
  const zoomAt = (k: number, fx = 0.5, fy = 0.5) =>
    setUserView((u) => {
      const v = u && u.garment === garmentId ? u.box : null;
      const b = fit(v ?? home, aspect, 0);
      const w = (b.maxX - b.minX) * k;
      const h = (b.maxY - b.minY) * k;
      const x = b.minX + (b.maxX - b.minX) * fx - w * fx;
      const y = b.minY + (b.maxY - b.minY) * fy - h * fy;
      return {
        garment: garmentId,
        box: { minX: x, maxX: x + w, minY: y, maxY: y + h },
      };
    });

  // The wheel listener is added once (non-passive); it calls the current zoomAt.
  const zoomRef = useRef(zoomAt);
  useEffect(() => {
    zoomRef.current = zoomAt;
  });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(
        Math.exp(e.deltaY * 0.0015),
        (e.clientX - r.left) / r.width,
        (e.clientY - r.top) / r.height,
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [host]);

  const toPattern = (e: { clientX: number; clientY: number }): P => {
    const r = host.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return [
      vb.minX + (e.clientX - r.left) * mmPerPx,
      -(vb.minY + (e.clientY - r.top) * mmPerPx),
    ];
  };

  // Panning or zooming during a drag would move the fit under the pointer: freeze it.
  const freeze = () => {
    if (!view) setView(vb);
  };

  return { size, view, setView, vb, mmPerPx, zoomAt, toPattern, freeze };
}
