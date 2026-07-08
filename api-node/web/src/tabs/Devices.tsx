import { useEffect, useState } from "react";
import { api, type PendingPairing } from "../api.js";

/** Approve device pairings with a button — the frontend replacement for the CLI / bare /pair page.
 *  Lists codes the app is currently showing; the admin taps Approve (their session is the auth, no PIN). */
export function Devices() {
  const [pending, setPending] = useState<PendingPairing[]>([]);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = () => api.pendingPairings().then((r) => setPending(r.pending)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 4000); // a freshly-started app appears within a few seconds
    return () => clearInterval(t);
  }, []);

  async function approve(userCode: string) {
    setMsg(null);
    try {
      const r = await api.approvePairing(userCode);
      setMsg({ text: r.message, ok: true });
      setCode("");
      load();
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    }
  }

  return (
    <div>
      <h2>Pending device pairings</h2>
      {pending.length === 0 ? (
        <p className="mut">No devices waiting. In the app: Settings → Cloud → Link, then its code shows here.</p>
      ) : (
        <table>
          <thead><tr><th>Code</th><th>Device</th><th /></tr></thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.user_code}>
                <td style={{ fontFamily: "monospace" }}>{p.user_code}</td>
                <td className="mut">{p.client_id ?? "—"}</td>
                <td><button className="btn primary" onClick={() => approve(p.user_code)}>Approve</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Approve by code</h2>
      <div className="row">
        <input value={code} placeholder="NOOP-XXXX" autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value)} />
        <button className="btn" onClick={() => approve(code)} disabled={!code.trim()}>Approve</button>
      </div>
      {msg && <p className={msg.ok ? "ok" : "err"}>{msg.text}</p>}
    </div>
  );
}
