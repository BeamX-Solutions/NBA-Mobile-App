"use client";

import { useId, useMemo, useState } from "react";

import { formatNaira } from "@/lib/format";

/**
 * Monthly branch fee trend, as the "Monthly Revenue Trends" card in the designs.
 *
 * One series, so there is no legend: the card title names it. Brand green,
 * 2px line over a soft fill, recessive gridlines, and a crosshair with a
 * tooltip on hover — an SVG chart in a browser is interactive, so it reads as
 * broken without one.
 *
 * The figures are summed from this branch's verified transactions. Months with
 * nothing verified plot as zero rather than being dropped, so a flat stretch
 * reads as a quiet month instead of being hidden by the line skipping it.
 */

export interface TrendPoint {
  /** First day of the month. */
  date: Date;
  label: string;
  /** Kobo. */
  value: number;
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const W = 640;
  const H = 260;
  const PAD = { top: 16, right: 16, bottom: 28, left: 8 };

  const geometry = useMemo(() => {
    const max = Math.max(...points.map((p) => p.value), 1);
    // Round the ceiling up so the top gridline is a readable number rather
    // than sitting exactly on the tallest point.
    const ceiling = max === 0 ? 1 : Math.pow(10, Math.floor(Math.log10(max))) *
      Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max))));

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;

    const coords = points.map((p, i) => ({
      x: PAD.left + i * step,
      y: PAD.top + innerH - (p.value / ceiling) * innerH,
    }));

    // Catmull-Rom to cubic bezier, giving the eased curve in the design
    // without letting the line overshoot below zero on a spike.
    let line = "";
    if (coords.length > 0) {
      line = `M ${coords[0].x} ${coords[0].y}`;
      for (let i = 0; i < coords.length - 1; i++) {
        const p0 = coords[i - 1] ?? coords[i];
        const p1 = coords[i];
        const p2 = coords[i + 1];
        const p3 = coords[i + 2] ?? p2;
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;
        line += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
      }
    }

    const baseline = PAD.top + innerH;
    const area =
      coords.length > 0
        ? `${line} L ${coords[coords.length - 1].x} ${baseline} L ${coords[0].x} ${baseline} Z`
        : "";

    return { coords, line, area, ceiling, baseline, innerH, step };
  }, [points]);

  if (points.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-ink-muted">
        No verified submissions yet, so there is nothing to plot.
      </p>
    );
  }

  const active = hover === null ? null : points[hover];
  const activeCoord = hover === null ? null : geometry.coords[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Branch fees verified by month. ${points
          .map((p) => `${p.label}: ${formatNaira(p.value)}`)
          .join(". ")}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-600)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-brand-600)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Recessive gridlines: three, including the baseline. */}
        {[0, 0.5, 1].map((t) => {
          const y = PAD.top + geometry.innerH * t;
          return (
            <line
              key={t}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y}
              y2={y}
              stroke="var(--color-hairline)"
              strokeWidth="1"
            />
          );
        })}

        <path d={geometry.area} fill={`url(#${gradientId})`} />
        <path
          d={geometry.line}
          fill="none"
          stroke="var(--color-brand-600)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Crosshair for the hovered month. */}
        {activeCoord !== null ? (
          <line
            x1={activeCoord.x}
            x2={activeCoord.x}
            y1={PAD.top}
            y2={geometry.baseline}
            stroke="var(--color-brand-600)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.5"
          />
        ) : null}

        {/* Markers, ringed in the surface colour so they read over the fill. */}
        {geometry.coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={hover === i ? 6 : 4.5}
            fill="var(--color-surface)"
            stroke="var(--color-brand-600)"
            strokeWidth="2.5"
          />
        ))}

        {/* Hit targets, wider than the marks. */}
        {geometry.coords.map((c, i) => (
          <rect
            key={`hit-${i}`}
            x={c.x - geometry.step / 2}
            y={0}
            width={geometry.step || W}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {points.map((p, i) => (
          <text
            key={p.label}
            x={geometry.coords[i].x}
            y={H - 8}
            textAnchor="middle"
            className="fill-[var(--color-ink-muted)] text-[11px]"
          >
            {p.label}
          </text>
        ))}
      </svg>

      {active !== null && activeCoord !== null ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[var(--radius-input)] border border-hairline bg-surface px-3 py-2 shadow-lg"
          style={{
            left: `${(activeCoord.x / W) * 100}%`,
            top: `${(activeCoord.y / H) * 100 - 4}%`,
          }}
        >
          <p className="text-xs text-ink-muted">{active.label}</p>
          <p className="tabular text-sm font-bold text-ink">{formatNaira(active.value)}</p>
        </div>
      ) : null}
    </div>
  );
}
