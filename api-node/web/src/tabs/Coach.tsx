import { useState } from "react";
import { api } from "../api.js";

/** Chat to the cloud AI coach (the cloud owns the prompt/provider/model). */
export function Coach() {
  const [q, setQ] = useState("");
  const [reply, setReply] = useState("Ask the cloud coach about your data.");
  const [busy, setBusy] = useState(false);

  async function ask() {
    if (!q.trim()) return;
    setBusy(true);
    setReply("thinking…");
    try {
      const r = await api.coach(q);
      setReply(r.reply);
    } catch (e) {
      setReply(`${(e as Error).message} — set AI_API_KEY on the cloud to enable the coach.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Coach</h2>
      <p className="mut" style={{ whiteSpace: "pre-wrap" }}>{reply}</p>
      <div className="row">
        <input value={q} placeholder="e.g. how did I recover last night?"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} />
        <button className="btn primary" disabled={busy} onClick={ask}>{busy ? "…" : "Ask"}</button>
      </div>
    </div>
  );
}
