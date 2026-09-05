"use client";
// Dependency-free inline SVG line/area chart. The project deliberately ships no
// charting library, so panels draw their own (as GexWidget does for its bars).

import { useMemo, useState } from "react";

export interface Series {
  key: string;
  label: string;
  color: string;
  points: Array<{ t: number; v: number }>;
  /** Fill under the line, for a single-series area chart. */
  fill?: boolean;
}

interface LineChartProps {
  series: Series[];
  height?: number;
  gridColor: string;
  textColor: string;
  formatValue: (value: number) => string;
  formatTime?: (t: number) => string;
  /** Force the y axis to include zero, so a sign change is visible. */
  includeZero?: boolean;
  emptyLabel?: string;
}

const PADDING = { top: 8, right: 8, bottom: 18, left: 52 };
const VIEW_W = 600;

function defaultTimeFormat(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 2; v += step) ticks.push(v);
  return ticks;
}

export default function LineChart({
  series,
  height = 160,
  gridColor,
  textColor,
  formatValue,
  formatTime = defaultTimeFormat,
  includeZero = false,
  emptyLabel = "No history yet",
}: LineChartProps) {
  const [hoverX, setHoverX] = useState<number | null>(null);

  const model = useMemo(() => {
    const all = series.flatMap(s => s.points);
    if (all.length === 0) return null;
    const times = all.map(p => p.t);
    const values = all.map(p => p.v);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    let minV = Math.min(...values);
    let maxV = Math.max(...values);
    if (includeZero) {
      minV = Math.min(minV, 0);
      maxV = Math.max(maxV, 0);
    }
    if (minV === maxV) {
      const pad = Math.abs(minV) * 0.05 || 1;
      minV -= pad;
      maxV += pad;
    }
    const innerW = VIEW_W - PADDING.left - PADDING.right;
    const innerH = height - PADDING.top - PADDING.bottom;
    const spanT = maxT - minT || 1;
    const x = (t: number) => PADDING.left + ((t - minT) / spanT) * innerW;
    const y = (v: number) => PADDING.top + innerH - ((v - minV) / (maxV - minV)) * innerH;
    return { minT, maxT, minV, maxV, x, y, innerW, innerH };
  }, [series, height, includeZero]);

  if (!model) {
    return (
      <div className="flex items-center justify-center text-[11px]" style={{ height, color: textColor }}>
        {emptyLabel}
      </div>
    );
  }

  const { x, y, minT, maxT } = model;
  const yTicks = niceTicks(model.minV, model.maxV, 4);
  const xTicks = [minT, minT + (maxT - minT) / 2, maxT];

  const hoverTime =
    hoverX === null
      ? null
      : minT + ((hoverX - PADDING.left) / model.innerW) * (maxT - minT);

  const hovered =
    hoverTime === null
      ? []
      : series
          .map(s => {
            let best: { t: number; v: number } | null = null;
            let bestDist = Infinity;
            for (const point of s.points) {
              const dist = Math.abs(point.t - hoverTime);
              if (dist < bestDist) {
                bestDist = dist;
                best = point;
              }
            }
            return best ? { series: s, point: best } : null;
          })
          .filter((h): h is { series: Series; point: { t: number; v: number } } => !!h);

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-full"
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverX(((e.clientX - rect.left) / rect.width) * VIEW_W);
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        {yTicks.map(tick => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={VIEW_W - PADDING.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke={gridColor}
              strokeWidth={1}
            />
            <text
              x={PADDING.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize={9}
              fill={textColor}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {xTicks.map((tick, i) => (
          <text
            key={i}
            x={x(tick)}
            y={height - 5}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            fontSize={9}
            fill={textColor}
          >
            {formatTime(tick)}
          </text>
        ))}

        {series.map(s => {
          if (s.points.length === 0) return null;
          const path = s.points
            .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`)
            .join(" ");
          const area =
            s.fill && s.points.length > 1
              ? `${path} L${x(s.points[s.points.length - 1].t).toFixed(2)},${y(
                  Math.max(model.minV, 0),
                ).toFixed(2)} L${x(s.points[0].t).toFixed(2)},${y(Math.max(model.minV, 0)).toFixed(2)} Z`
              : null;
          return (
            <g key={s.key}>
              {area && <path d={area} fill={s.color} opacity={0.12} />}
              <path
                d={path}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {hoverX !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={PADDING.top}
            y2={height - PADDING.bottom}
            stroke={gridColor}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {hovered.map(h => (
          <circle
            key={h.series.key}
            cx={x(h.point.t)}
            cy={y(h.point.v)}
            r={2.5}
            fill={h.series.color}
          />
        ))}
      </svg>

      {hovered.length > 0 && hoverX !== null && (
        <div
          className="pointer-events-none absolute top-1 px-2 py-1 rounded text-[10px] whitespace-nowrap bg-black/80 text-white"
          style={{
            left: `${Math.min(80, (hoverX / VIEW_W) * 100)}%`,
          }}
        >
          <div className="opacity-70">{formatTime(hovered[0].point.t)}</div>
          {hovered.map(h => (
            <div key={h.series.key} className="flex gap-2 items-center">
              <span style={{ color: h.series.color }}>■</span>
              <span>{h.series.label}</span>
              <span className="font-medium">{formatValue(h.point.v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
