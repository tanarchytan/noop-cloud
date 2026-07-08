import type Database from "better-sqlite3";
import { now } from "./db.js";

/**
 * Cuffless blood-pressure **estimate** from the WHOOP 5.0 optical PPG waveform (see
 * docs/BP-FEASIBILITY.md). The 5.0 has no BP model on-strap — it streams a 24 Hz PPG waveform (noop
 * already decodes it). This module extracts pulse-wave features from that waveform and maps them to
 * systolic/diastolic using a **per-user cuff calibration** plus population-prior slopes.
 *
 * ⚠️ This is an UNVALIDATED WELLNESS ESTIMATE, not a medical measurement. It tracks deltas from the
 * user's last cuff calibration; it drifts and needs recalibration. Never a diagnosis.
 *
 * The whole model lives here so it can be tuned without an app release — the app only sends the raw
 * PPG window (samples + sample rate) it already receives from the strap.
 */

export interface PpgFeatures {
  hr: number;          // bpm, from the dominant pulse period
  upstrokeMs: number;  // mean foot→peak rise time (shorter ≈ stiffer arteries ≈ higher BP)
  amplitude: number;   // mean peak−foot (normalised ADC)
  widthMs: number;     // mean pulse width at half amplitude
  pulses: number;      // clean pulses detected (quality signal)
}

export interface BpEstimate { systolic: number; diastolic: number; confidence: number; features: PpgFeatures }

// ── population-prior slopes (documented, rough — honest constants, not clinical) ──────────────────
const K_HR_SBP = 0.4;    // mmHg per bpm above the calibration HR
const K_UP_SBP = 0.08;   // mmHg per ms the upstroke is SHORTER than calibration
const K_HR_DBP = 0.25;
const K_UP_DBP = 0.04;

export function ensureSchema(d: Database.Database): void {
  d.exec(
    `CREATE TABLE IF NOT EXISTS bp_calibration (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       systolic INTEGER, diastolic INTEGER,
       hr REAL, upstroke_ms REAL, amplitude REAL, width_ms REAL, calibrated_at INTEGER)`,
  );
  d.exec(
    `CREATE TABLE IF NOT EXISTS bp_reading (
       ts INTEGER PRIMARY KEY, systolic INTEGER, diastolic INTEGER, confidence REAL,
       hr REAL, upstroke_ms REAL)`,
  );
}

// ── PPG DSP ───────────────────────────────────────────────────────────────────────────────────────
/** Extract pulse-wave features from a raw PPG window. Detrends, finds pulse feet/peaks, measures the
 *  rise time / amplitude / width. Returns null if the signal is too poor to trust. */
export function extractFeatures(ppg: number[], fs: number): PpgFeatures | null {
  if (!Array.isArray(ppg) || ppg.length < fs * 3 || fs <= 0) return null;
  const n = ppg.length;

  // Linear detrend (remove DC + baseline wander).
  const xs = Array.from({ length: n }, (_, i) => i);
  const mx = (n - 1) / 2;
  const my = ppg.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ppg[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  const sig = ppg.map((v, i) => v - (my + slope * (i - mx)));

  // HR by normalised autocorrelation over 30–220 bpm (mirrors noop's PpgHr approach).
  const minLag = Math.floor((fs * 60) / 220), maxLag = Math.ceil((fs * 60) / 30);
  let bestLag = 0, bestR = 0;
  const energy = sig.reduce((a, b) => a + b * b, 0) || 1;
  for (let lag = minLag; lag <= Math.min(maxLag, n - 1); lag++) {
    let r = 0;
    for (let i = 0; i + lag < n; i++) r += sig[i] * sig[i + lag];
    r /= energy;
    if (r > bestR) { bestR = r; bestLag = lag; }
  }
  if (bestLag === 0 || bestR < 0.3) return null; // no clean pulse
  const hr = (60 * fs) / bestLag;

  // Pulse feet = local minima roughly one period apart; measure foot→peak rise + amplitude + width.
  const period = bestLag;
  const ups: number[] = [], amps: number[] = [], widths: number[] = [];
  for (let start = 0; start + period < n; start += period) {
    // foot = min in [start, start+period*0.5]; peak = max after the foot within a period.
    let footI = start, footV = sig[start];
    for (let i = start; i < start + period * 0.5 && i < n; i++) if (sig[i] < footV) { footV = sig[i]; footI = i; }
    let peakI = footI, peakV = sig[footI];
    for (let i = footI; i < footI + period && i < n; i++) if (sig[i] > peakV) { peakV = sig[i]; peakI = i; }
    if (peakI <= footI) continue;
    const amp = peakV - footV;
    if (amp <= 0) continue;
    ups.push(((peakI - footI) / fs) * 1000);
    amps.push(amp);
    // width at half amplitude around the peak.
    const half = footV + amp / 2;
    let l = peakI; while (l > footI && sig[l] > half) l--;
    let rr = peakI; while (rr < n - 1 && sig[rr] > half) rr++;
    widths.push(((rr - l) / fs) * 1000);
  }
  if (ups.length < 2) return null;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return { hr, upstrokeMs: mean(ups), amplitude: mean(amps), widthMs: mean(widths), pulses: ups.length };
}

// ── calibration + estimate ──────────────────────────────────────────────────────────────────────
export function calibrate(d: Database.Database, systolic: number, diastolic: number, f: PpgFeatures): void {
  d.prepare(
    `INSERT INTO bp_calibration(id,systolic,diastolic,hr,upstroke_ms,amplitude,width_ms,calibrated_at)
     VALUES(1,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET systolic=excluded.systolic,diastolic=excluded.diastolic,hr=excluded.hr,
       upstroke_ms=excluded.upstroke_ms,amplitude=excluded.amplitude,width_ms=excluded.width_ms,
       calibrated_at=excluded.calibrated_at`,
  ).run(systolic, diastolic, f.hr, f.upstrokeMs, f.amplitude, f.widthMs, now());
}

interface CalRow { systolic: number; diastolic: number; hr: number; upstroke_ms: number }

export function getCalibration(d: Database.Database): CalRow | null {
  return (d.prepare("SELECT systolic,diastolic,hr,upstroke_ms FROM bp_calibration WHERE id=1").get() as CalRow) ?? null;
}

/** Estimate SBP/DBP from features, relative to the cuff calibration. Returns null if not calibrated. */
export function estimate(d: Database.Database, f: PpgFeatures): BpEstimate | null {
  const cal = getCalibration(d);
  if (!cal) return null;
  const dHr = f.hr - cal.hr;
  const dUp = cal.upstroke_ms - f.upstrokeMs; // positive when upstroke shortened (stiffer → higher BP)
  const systolic = Math.round(cal.systolic + K_HR_SBP * dHr + K_UP_SBP * dUp);
  const diastolic = Math.round(cal.diastolic + K_HR_DBP * dHr + K_UP_DBP * dUp);
  // Confidence from pulse count + how far we are from the calibration point (extrapolation penalty).
  const drift = Math.min(1, (Math.abs(dHr) / 40 + Math.abs(dUp) / 100));
  const confidence = Math.max(0.1, Math.min(0.9, (f.pulses / 8) * (1 - 0.5 * drift)));
  // Clamp to a sane physiological range so a bad window can't emit nonsense.
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const est: BpEstimate = {
    systolic: clamp(systolic, 80, 200), diastolic: clamp(diastolic, 40, 130),
    confidence: Number(confidence.toFixed(2)), features: f,
  };
  d.prepare("INSERT OR REPLACE INTO bp_reading(ts,systolic,diastolic,confidence,hr,upstroke_ms) VALUES(?,?,?,?,?,?)")
    .run(now(), est.systolic, est.diastolic, est.confidence, f.hr, f.upstrokeMs);
  return est;
}

export function latest(d: Database.Database): Record<string, unknown> {
  const cal = getCalibration(d);
  const reading = d.prepare("SELECT * FROM bp_reading ORDER BY ts DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  return { calibrated: !!cal, calibration: cal, latest: reading ?? null };
}
