// SPDX-License-Identifier: AGPL-3.0-or-later
import { type RefObject, useEffect, useState } from "react";

/** An element's size in CSS pixels (at least 1), following its resizes. */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 1, h: 1 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
