const CIRC = 2 * Math.PI * 52; // r = 52

/** A WHOOP-style circular gauge. [pct] 0–100 fills the arc; [color] tints it; [label] is the big value. */
export function Ring({ pct, label, name, color }: {
  pct: number | null; label: string; name: string; color: string;
}) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const offset = CIRC - (CIRC * p) / 100;
  return (
    <div className="ring">
      <svg viewBox="0 0 120 120">
        <circle className="track" cx="60" cy="60" r="52" />
        <circle
          className="arc" cx="60" cy="60" r="52"
          style={{ stroke: pct == null ? "#20262d" : color, strokeDasharray: CIRC, strokeDashoffset: offset }}
        />
      </svg>
      <div className="ringlabel">
        <div className="rv">{label}</div>
        <div className="rk">{name}</div>
      </div>
    </div>
  );
}

/** Recovery colour thresholds mirror WHOOP: red < 34, amber < 67, else green. */
export function recoveryColor(v: number | null): string {
  if (v == null) return "#20262d";
  return v < 34 ? "var(--red)" : v < 67 ? "var(--amber)" : "var(--green)";
}
