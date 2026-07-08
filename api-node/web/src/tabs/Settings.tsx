import { useState } from "react";
import { api } from "../api.js";

/** Change your own password. */
export function Settings() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function save() {
    setMsg(null);
    try {
      await api.changePassword(pw);
      setPw("");
      setMsg({ text: "updated ✓", ok: true });
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    }
  }

  return (
    <div>
      <h2>Change password</h2>
      <div className="row">
        <input type="password" value={pw} placeholder="new password" minLength={4}
          onChange={(e) => setPw(e.target.value)} />
        <button className="btn" onClick={save}>Update</button>
      </div>
      {msg && <p className={msg.ok ? "ok" : "err"}>{msg.text}</p>}
    </div>
  );
}
