"use client";

/** Minimal uPlot wrapper: resizes with its container, rebuilds when options change. */
import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export function UPlot({
  options,
  data,
  onCreate,
  className,
  height,
}: {
  /** Plot height in px (the legend renders below it). */
  height: number;
  options: Omit<uPlot.Options, "width" | "height">;
  data: uPlot.AlignedData;
  onCreate?: (u: uPlot) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const u = new uPlot({ ...options, width: el.clientWidth, height }, data, el);
    plot.current = u;
    onCreate?.(u);
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
      plot.current = null;
    };
    // Rebuild only when the option object identity changes; data updates go through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, height]);

  useEffect(() => {
    plot.current?.setData(data);
  }, [data]);

  return <div ref={ref} className={className} />;
}
