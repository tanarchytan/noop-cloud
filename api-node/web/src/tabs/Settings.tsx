import { useState } from "react";
import { api, isValidPassword, PASSWORD_HINT } from "../api.js";

/** Change your own password. */
export function Settings() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function save() {
    setMsg(null);
    if (!isValidPassword(pw)) {
      setMsg({ text: PASSWORD_HINT, ok: false });
      return;
    }
    try {
      await api.changePassword(pw.trim());
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
        <input type="password" value={pw} placeholder="xxx-xxx-xxx" maxLength={11}
          onChange={(e) => setPw(e.target.value)} />
        <button className="btn" onClick={save}>Update</button>
      </div>
      <p className="mut">{PASSWORD_HINT}</p>
      {msg && <p className={msg.ok ? "ok" : "err"}>{msg.text}</p>}
    </div>
  );
}
