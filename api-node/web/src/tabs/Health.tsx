import { useEffect, useState } from "react";
import { api, type DailyMetrics, type HistoryResponse } from "../api.js";

/** Metric history: Recovery / Sleep / Strain sparklines + the latest vitals. */
export function Health() {
  const [h, setH] = useState<HistoryResponse | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.history(30).then(setH).catch((e) => setErr(String(e.message)));
  }, []);

  const days = h?.days ?? [];
  const latest = days.at(-1);

  return (
    <div>
      <h2>Trends — last {days.length} day(s)</h2>
      {days.length === 0 ? (
        <p className="mut">{err || "No history yet — sync from the app to populate trends."}</p>
      ) : (
        <>
          <Spark days={days} pick={(d) => d.recovery} label="Recovery" unit="%" color="var(--green)" max={100} />
          <Spark days={days} pick={(d) => d.sleep_perf} label="Sleep" unit="%" color="var(--teal)" max={100} />
          <Spark days={days} pick={(d) => d.strain} label="Strain" unit="" color="var(--cyan)" max={100} />
        </>
      )}

      <h2>Latest vitals</h2>
      <div className="grid">
        <Cell k="SpO₂" v={latest?.spo2} p="%" />
        <Cell k="Skin temp" v={latest?.skin_temp} p="°C dev" />
        <Cell k="Respiratory" v={latest?.respiratory} p="rpm" />
        <Cell k="Steps" v={latest?.steps} p="" />
        <Cell k="Resting HR" v={latest?.resting_hr} p="bpm" />
        <Cell k="HRV" v={latest?.hrv} p="ms" />
      </div>
    </div>
  );
}

function Spark({ days, pick, label, unit, color, max }: {
  days: DailyMetrics[]; pick: (d: DailyMetrics) => number | null; label: string; unit: string;
  color: string; max: number;
}) {
  const vals = days.map(pick);
  const present = vals.filter((v): v is number => v != null);
  const latest = present.at(-1);
  if (present.length === 0) return null;
  return (
    <div style={{ marginBottom: "1rem" }}>
      <div className="mut" style={{ display: "flex", justifyContent: "space-between", fontSize: ".8rem" }}>
        <span>{label}</span>
        <span>{latest != null ? `${(+latest).toFixed(unit === "%" ? 0 : 1)}${unit}` : "—"}</span>
      </div>
      <div className="spark">
        {days.map((d, i) => {
          const v = pick(d);
          return (
            <span key={i} title={`${d.day}: ${v ?? "—"}`}
              style={{ height: `${((v ?? 0) / max) * 100}%`, background: color, opacity: v == null ? 0.15 : 0.85 }} />
          );
        })}
      </div>
    </div>
  );
}

function Cell({ k, v, p }: { k: string; v: number | null | undefined; p: string }) {
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className="v">{v == null ? "—" : v}</div>
      <div className="p">{v == null ? "no data yet" : p}</div>
    </div>
  );
}
