"use client";
// Tiny inline trend line for table cells.

interface SparklineProps {
  points: Array<{ t: number; v: number }>;
  width?: number;
  height?: number;
  color: string;
  /** Draw a zero baseline, so a sign flip is readable at this size. */
  zeroLine?: boolean;
  zeroColor?: string;
}

export default function Sparkline({
  points,
  width = 72,
  height = 20,
  color,
  zeroLine = false,
  zeroColor = "#71717a",
}: SparklineProps) {
  if (points.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }

  const times = points.map(p => p.t);
  const values = points.map(p => p.v);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  let minV = Math.min(...values);
  let maxV = Math.max(...values);
  if (zeroLine) {
    minV = Math.min(minV, 0);
    maxV = Math.max(maxV, 0);
  }
  if (minV === maxV) {
    const pad = Math.abs(minV) * 0.05 || 1;
    minV -= pad;
    maxV += pad;
  }

  const spanT = maxT - minT || 1;
  const x = (t: number) => ((t - minT) / spanT) * (width - 2) + 1;
  const y = (v: number) => height - 1 - ((v - minV) / (maxV - minV)) * (height - 2);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      {zeroLine && minV < 0 && maxV > 0 && (
        <line x1={1} x2={width - 1} y1={y(0)} y2={y(0)} stroke={zeroColor} strokeWidth={0.5} strokeDasharray="2 2" />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={1.25} />
    </svg>
  );
}
