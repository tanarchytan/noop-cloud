import { useEffect, useState } from "react";
import { api, type BpLatest, type DailyMetrics } from "../api.js";
import { Ring, recoveryColor } from "../components/Ring.js";

const fmt = (v: number | null, suffix = "") => (v == null ? "—" : `${v}${suffix}`);
const fmt1 = (v: number | null) => (v == null ? "—" : (+v).toFixed(1));

/** Today's score stack: Recovery / Sleep / Strain rings + secondary vitals. */
export function Home() {
  const [m, setM] = useState<DailyMetrics | null>(null);
  const [bp, setBp] = useState<BpLatest | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.today().then(setM).catch((e) => setErr(String(e.message)));
    api.bp().then(setBp).catch(() => {});
  }, []);

  const bpText = bp?.latest ? `${bp.latest.systolic}/${bp.latest.diastolic}`
    : bp?.calibrated ? "—" : "not set up";

  return (
    <div>
      <div className="rings">
        <Ring name="Recovery" pct={m?.recovery ?? null} color={recoveryColor(m?.recovery ?? null)}
          label={m?.recovery != null ? `${m.recovery}%` : "—"} />
        <Ring name="Sleep" pct={m?.sleep_perf ?? null} color="var(--teal)"
          label={m?.sleep_perf != null ? `${m.sleep_perf}%` : "—"} />
        <Ring name="Strain" pct={m?.strain ?? null} color="var(--cyan)"
          label={fmt1(m?.strain ?? null)} />
      </div>
      <div className="grid">
        <Metric k="Resting HR" v={fmt(m?.resting_hr ?? null)} p="bpm" />
        <Metric k="HRV" v={m?.hrv != null ? (+m.hrv).toFixed(0) : "—"} p="ms" />
        <Metric k="Respiratory" v={fmt(m?.respiratory ?? null)} p="rpm" />
        <Metric k="SpO₂" v={fmt(m?.spo2 ?? null)} p="%" />
        <Metric k="Blood pressure" v={bpText}
          p={bp?.latest ? `est · ${Math.round((bp.latest.confidence ?? 0) * 100)}% conf` : "experimental"} />
      </div>
      <p className="mut">
        {err ? `Error: ${err}` : m?.synced_at
          ? `Last sync: ${new Date(m.synced_at * 1000).toLocaleString()}${m.provenance ? " · " + m.provenance : ""}`
          : "Waiting for the app to sync… link a device in the app and turn on cloud sync."}
      </p>
    </div>
  );
}

function Metric({ k, v, p }: { k: string; v: string; p: string }) {
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      <div className="p">{p}</div>
    </div>
  );
}
