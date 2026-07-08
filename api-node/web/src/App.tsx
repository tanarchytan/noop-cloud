import { useEffect, useState } from "react";
import { api, type Session } from "./api.js";
import { Home } from "./tabs/Home.js";
import { Health } from "./tabs/Health.js";
import { Coach } from "./tabs/Coach.js";
import { Devices } from "./tabs/Devices.js";
import { Admin } from "./tabs/Admin.js";
import { Settings } from "./tabs/Settings.js";

type Tab = "home" | "health" | "coach" | "devices" | "admin" | "settings";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("home");

  useEffect(() => {
    api.session()
      .then((s) => {
        if (s.must_change) { window.location.href = "/change"; return; }
        setSession(s);
      })
      .catch(() => { /* api.session already redirects to /login on 401 */ });
  }, []);

  if (!session) return <div className="center">Loading…</div>;

  const tabs: Array<[Tab, string]> = [
    ["home", "Home"], ["health", "Health"], ["coach", "Coach"],
    ...(session.is_admin ? [["devices", "Devices"], ["admin", "Admin"]] as Array<[Tab, string]> : []),
    ["settings", "Settings"],
  ];

  return (
    <div className="wrap">
      <header>
        <div><b>noop-cloud</b> <span className="who">· {session.username}</span></div>
        <button className="btn" onClick={() => api.logout().then(() => (window.location.href = "/login"))}>
          Sign out
        </button>
      </header>
      <nav>
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {tab === "home" && <Home />}
      {tab === "health" && <Health />}
      {tab === "coach" && <Coach />}
      {tab === "devices" && session.is_admin && <Devices />}
      {tab === "admin" && session.is_admin && <Admin />}
      {tab === "settings" && <Settings />}
    </div>
  );
}
