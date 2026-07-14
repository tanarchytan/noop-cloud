import { useEffect, useState } from "react";
import { api, isValidPassword, PASSWORD_HINT, type UserRow } from "../api.js";

/** Admin-only user management (add / list / delete). */
export function Admin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [nu, setNu] = useState("");
  const [np, setNp] = useState("");
  const [na, setNa] = useState(false);
  const [err, setErr] = useState("");

  const load = () => api.users().then((r) => setUsers(r.users)).catch((e) => setErr(String(e.message)));
  useEffect(() => { load(); }, []);

  async function add() {
    setErr("");
    if (!isValidPassword(np)) { setErr(PASSWORD_HINT); return; }
    try {
      await api.addUser(nu, np.trim(), na);
      setNu(""); setNp(""); setNa(false);
      load();
    } catch (e) { setErr((e as Error).message); }
  }

  async function del(username: string) {
    if (!confirm(`Delete ${username}?`)) return;
    await api.deleteUser(username);
    load();
  }

  return (
    <div>
      <h2>Users</h2>
      <table>
        <thead><tr><th>User</th><th>Role</th><th>Status</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.username}>
              <td>{u.username}</td>
              <td>{u.is_admin ? "admin" : "user"}</td>
              <td>{u.must_change ? "must change" : "active"}</td>
              <td>{u.username !== "admin" && <button className="del" onClick={() => del(u.username)}>delete</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Add user</h2>
      <div className="row">
        <input value={nu} placeholder="username" onChange={(e) => setNu(e.target.value)} />
        <input value={np} type="password" placeholder="xxx-xxx-xxx" maxLength={11} onChange={(e) => setNp(e.target.value)} />
        <label className="mut" style={{ display: "flex", alignItems: "center", gap: ".3rem" }}>
          <input type="checkbox" checked={na} style={{ flex: "none" }} onChange={(e) => setNa(e.target.checked)} /> admin
        </label>
        <button className="btn" onClick={add}>Add</button>
      </div>
      <p className="err">{err}</p>
    </div>
  );
}
