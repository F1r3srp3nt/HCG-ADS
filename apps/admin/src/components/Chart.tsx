import { useId, useMemo, useState } from "react";

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  /** "right": scaled on its own (e.g. clicks next to impressions). Default: shared left scale. */
  axis?: "left" | "right";
}

/** Animated SVG area chart. Left-axis series share one scale; right-axis series are scaled on their own. */
export function AreaChart({ labels, series, height = 220, watermark }: { labels: string[]; series: Series[]; height?: number; watermark?: string }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 800, H = height, padL = 8, padR = 8, padT = 16, padB = 26;
  const n = Math.max(labels.length, 2);
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const leftMax = Math.max(1, ...series.filter((s) => s.axis !== "right").flatMap((s) => s.values));
  const paths = useMemo(() => series.map((s) => {
    const max = s.axis === "right" ? Math.max(1, ...s.values) : leftMax;
    const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
    const pts = s.values.map((v, i) => [x(i), y(v)] as const);
    const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
    const area = `${line} L${x(s.values.length - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`;
    return { ...s, line, area, max, y };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [series, H, n, leftMax]);
  const empty = series.every((s) => s.values.every((v) => v === 0));

  return (
    <div className="chart">
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key} className="legend-item"><i style={{ background: s.color }} />{s.label}{s.axis === "right" && series.length > 1 && <small className="muted"> (own scale)</small>}
            {hover !== null && <b>{(s.values[hover] ?? 0).toLocaleString("en-GB")}</b>}
          </span>
        ))}
        {hover !== null && <span className="legend-day">{labels[hover]}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart-svg" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
          setHover(Math.max(0, Math.min(labels.length - 1, i)));
        }}>
        <defs>
          {paths.map((p) => (
            <linearGradient key={p.key} id={`g-${id}-${p.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={p.color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={p.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={padL} x2={W - padR} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} className="chart-grid" />)}
        {paths.map((p) => (
          <g key={p.key}>
            <path d={p.area} fill={`url(#g-${id}-${p.key})`} className="chart-area" />
            <path d={p.line} fill="none" stroke={p.color} strokeWidth={2.2} className="chart-line" pathLength={1} />
          </g>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} className="chart-cursor" />
            {paths.map((p) => <circle key={p.key} cx={x(hover)} cy={p.y(p.values[hover] ?? 0)} r={4} fill={p.color} />)}
          </g>
        )}
        {labels.map((l, i) => (i % Math.ceil(labels.length / 7) === 0 || i === labels.length - 1) && (
          <text key={l} x={x(i)} y={H - 6} className="chart-label" textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}>{l.slice(5)}</text>
        ))}
      </svg>
      {empty && <div className="chart-empty">No events recorded in this period</div>}
      {watermark && <div className="chart-watermark">{watermark}</div>}
    </div>
  );
}

/** Horizontal bars for rankings. */
export function Bars({ rows, color = "var(--cyan)" }: { rows: Array<{ label: string; value: number; sub?: string }>; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <div className="bar-label" title={r.label}>{r.label}</div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: color }} /></div>
          <div className="bar-value">{r.value.toLocaleString("en-GB")}{r.sub && <small> {r.sub}</small>}</div>
        </div>
      ))}
    </div>
  );
}
