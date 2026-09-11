"use client";

import { useLayoutEffect, useRef, useState } from "react";

export interface Size {
  w: number;
  h: number;
}

/**
 * Observe an element's content box. Returns whole-pixel sizes and only updates
 * on a real change, so it never feeds back into a resize loop.
 */
export function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (w: number, h: number) => {
      const next = { w: Math.round(w), h: Math.round(h) };
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    };
    update(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) update(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size] as const;
}
