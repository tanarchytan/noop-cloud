/** Typed fetch helpers for the noop-cloud API. All calls are same-origin and cookie-authenticated. */

export interface Session { id: number; username: string; is_admin: boolean; must_change: boolean }

export interface DailyMetrics {
  day?: string;
  recovery: number | null; sleep_perf: number | null; strain: number | null;
  resting_hr: number | null; hrv: number | null; spo2: number | null;
  skin_temp: number | null; respiratory: number | null; steps: number | null;
  provenance: string | null; synced_at: number | null;
}

export interface HistoryResponse { days: DailyMetrics[]; hr: Array<{ ts: number; bpm: number }> }
export interface UserRow { username: string; is_admin: number; must_change: number; created: number }
export interface PendingPairing { user_code: string; client_id: string | null; created: number }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  if (r.status === 401) { window.location.href = "/login"; throw new Error("unauthorized"); }
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

function jsonInit(method: string, data: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

export const api = {
  session: () => req<Session>("/api/session"),
  logout: () => fetch("/api/logout", { method: "POST", credentials: "same-origin" }),
  today: () => req<DailyMetrics>("/api/metrics/today"),
  history: (days = 30) => req<HistoryResponse>(`/api/metrics/history?days=${days}`),
  coach: (message: string) =>
    req<{ reply: string; model: string }>("/api/coach/chat", jsonInit("POST", { messages: [{ role: "user", content: message }] })),
  changePassword: (newPassword: string) =>
    req<{ ok: boolean }>("/api/password", jsonInit("POST", { new_password: newPassword })),
  users: () => req<{ users: UserRow[] }>("/api/users"),
  addUser: (username: string, password: string, isAdmin: boolean) =>
    req<{ ok: boolean }>("/api/users", jsonInit("POST", { username, password, is_admin: isAdmin })),
  deleteUser: (username: string) =>
    req<{ ok: boolean }>(`/api/users?username=${encodeURIComponent(username)}`, { method: "DELETE", credentials: "same-origin" }),
  pendingPairings: () => req<{ pending: PendingPairing[] }>("/api/pair/pending"),
  approvePairing: (userCode: string) =>
    req<{ ok: boolean; message: string }>("/api/pair/approve", jsonInit("POST", { user_code: userCode })),
};
