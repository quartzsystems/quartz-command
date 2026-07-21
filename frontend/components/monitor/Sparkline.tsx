"use client";

import { useId } from "react";

/// A compact filled-area sparkline for a utilization series (0–100%). Pure
/// inline SVG — no chart dependency — stretched to fill its container via a
/// non-preserved viewBox so it stays crisp at any width. `color` is any CSS
/// color (pass a design token like "var(--qz-accent)").
export function Sparkline({
  values,
  color,
  max = 100,
  height = 44,
}: {
  values: number[];
  color: string;
  max?: number;
  height?: number;
}) {
  const gradId = useId();
  // A flat internal coordinate space; the SVG scales it to the box.
  const W = 100;
  const H = 100;

  if (values.length === 0) {
    return (
      <div
        className="w-full grid place-items-center text-[11px]"
        style={{ height, color: "var(--qz-fg-4)" }}
      >
        No samples yet
      </div>
    );
  }

  // One point → draw a flat line at its level so the card still reads.
  const pts = values.length === 1 ? [values[0], values[0]] : values;
  const n = pts.length;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - (Math.max(0, Math.min(max, v)) / max) * H;

  const line = pts.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} stroke="none" />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
