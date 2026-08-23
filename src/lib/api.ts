// Thin client — Vite proxies /api to the SAM brain on :8787

export interface AgentResult {
  kind: "final" | "pending";
  text?: string;
  trace: string[];
  provider?: string;
  // pending (a risky action awaiting approval — held server-side, approved by id):
  pendingId?: string;
  tool?: string;
  input?: any;
  preview?: string;
  activity?: string;
  transcript?: string;
  // echoed back so we can resume:
  skill?: string | null;
  projectId?: string;
  tier?: string;
  message?: string;
}

export interface UserProfile { name?: string; about?: string; mode?: "business" | "personal"; language?: string; persona?: string }
let USER: UserProfile = {};
export function setUser(u: UserProfile) { USER = u || {}; }

export interface Attachment { kind: "image" | "text"; name: string; mime?: string; data?: string; text?: string }

// A prior conversation turn, sent so the model has context for "proceed"/"continue".
export interface ChatTurn { role: "user" | "sam"; text: string }

export async function command(message: string, projectId?: string, tier?: string, signal?: AbortSignal, attachments?: Attachment[], history?: ChatTurn[]): Promise<AgentResult> {
  const res = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, projectId, tier, user: USER, attachments, history }),
    signal,
  });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

export async function executeSmartAction(intent: string): Promise<any> {
  const res = await fetch("/api/smart-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent }),
  });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

// Turn a failed response into a typed error so the UI can tell auth failures apart from provider or
// network failures — instead of every catch guessing (the camera's old "need a Gemini key" blamed the
// key for ANY failure and nearly got a security gate turned off). `locked` = this device isn't paired.
export interface ApiError extends Error { status?: number; locked?: boolean; hint?: string }
export async function apiError(res: Response): Promise<ApiError> {
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON error body */ }
  const e = new Error(body?.error || `request failed (${res.status})`) as ApiError;
  e.status = res.status;
  e.locked = res.status === 401 || body?.locked === true;
  e.hint = body?.hint;
  return e;
}

// Approve (or decline) a pending risky action and continue the agent.
// `always` = "yes, and always allow this action" (standing authorization).
export async function confirm(pending: AgentResult, approved: boolean, always = false): Promise<AgentResult> {
  // The action itself is held server-side — we only send its id + the verdict.
  const res = await fetch("/api/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingId: pending.pendingId, approved, always }),
  });
  if (!res.ok && res.status !== 410) throw new Error("confirm failed");
  return res.json();
}

// Streaming command — calls onEvent for each {type: token|tool|pending|done} event.
export async function streamCommand(message: string, projectId: string | undefined, tier: string | undefined, onEvent: (e: any) => void, signal?: AbortSignal, history?: ChatTurn[]): Promise<void> {
  const res = await fetch("/api/stream", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, projectId, tier, user: USER, history }), signal,
  });
  if (!res.ok || !res.body) throw new Error("stream failed");
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n"); buf = parts.pop() || "";
    for (const p of parts) {
      const line = p.trim(); if (!line.startsWith("data:")) continue;
      try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* corrupt stored value — treat as absent and use the default */ }
    }
  }
}

// Standing authorizations
export const getAllowed = () => get("/api/allow");
export const setAllow = (tool: string, on: boolean) =>
  post("/api/allow", { tool, on });

export const getProjects = () => get("/api/projects");
export const getLog = () => get("/api/vault/log");
export const getStatus = () => get("/api/status");
export const getQuotes = (symbols: string) =>
  get(`/api/quotes?symbols=${encodeURIComponent(symbols)}`);
export const runArena = (prompt?: string) =>
  post("/api/arena", { prompt });
export const getArena = () => get("/api/arena");
export const clearArena = () => del("/api/arena");
export const getTools = () => get("/api/tools");

// Admin — manage provider API keys (rolling pools) + config from the app.
export const getAdminConfig = () => get("/api/admin/config");
export const saveKeys = (provider: string, keys: string) =>
  post("/api/admin/keys", { provider, keys });
export const saveConfig = (key: string, value: string) =>
  post("/api/admin/config", { key, value });
export const getMcpPresets = () => get("/api/mcp/presets");
export const configureMcp = (id: string, env: Record<string,string>) => post("/api/mcp/configure", { id, env });
export const removeMcp = (id: string) => post("/api/mcp/remove", { id });
export const getPhoneLink = () => get("/api/phone-link");
export const regeneratePhone = () => post("/api/phone-regenerate");
export const disablePhone = () => post("/api/phone-disable");
export const enablePhone = () => post("/api/phone-enable");
export const testEmail = (): Promise<{ ok: boolean; error?: string }> =>
  post("/api/admin/test-email");

// Self-update — SAM checks the repo and can pull the latest (evolve, for free).
export async function checkUpdate(): Promise<{ behind: boolean; current?: string; latest?: string; url?: string }> {
  try { const r = await fetch("/api/update-check"); return await r.json(); } catch { return { behind: false }; }
}
export async function runUpdate(): Promise<{ ok: boolean; output?: string; error?: string }> {
  try { const r = await fetch("/api/update", { method: "POST" }); return await r.json(); } catch (e: any) { return { ok: false, error: String(e) }; }
}

// Security watchdog status (Jeeves on the door).
export async function getSecurity(): Promise<{ status: any; events: any[] }> {
  try {
    const r = await fetch("/api/security");
    // A refusal from the read guard is perfectly good JSON, so `await r.json()` hands back
    // {error, locked} and the caller's `d.status` is undefined — the shield renders its
    // all-clear icon and "Checking…" forever, which is the panel claiming safety it never
    // established. Shape the refusal like a result and SAY it, rather than letting an
    // unpaired tab read reassurance into silence.
    if (!r.ok) return { status: { clear: null, headline: "Pair this device to see what SAM has blocked" }, events: [] };
    return await r.json();
  } catch { return { status: { clear: true, headline: "—" }, events: [] }; }
}

// Proactive — briefs & nudges SAM wants to show you (drained on read).
export async function getProactive(): Promise<{ items: { type: string; text: string; at: string }[]; nudges: any[] }> {
  try { const r = await fetch("/api/proactive"); return await r.json(); } catch { return { items: [], nudges: [] }; }
}

// The Team / The Ninjas — SSE: emits plan → agent-start → agent-done → final.
export async function streamTeam(message: string, projectId: string | undefined, onEvent: (e: any) => void, kind: "team" | "ninjas" = "team"): Promise<void> {
  const res = await fetch(kind === "ninjas" ? "/api/ninjas" : "/api/team", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, projectId, user: USER }),
  });
  if (!res.ok || !res.body) throw new Error(kind + " failed");
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n"); buf = parts.pop() || "";
    for (const p of parts) { const line = p.trim(); if (!line.startsWith("data:")) continue; try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* corrupt stored value — treat as absent and use the default */ } }
  }
}
export const getRoster = () => get("/api/team/roster");

// Autopilot — SAM lifts the silly work autonomously (serious actions still ask).
export const getAutopilot = () => get("/api/autopilot");
export const setAutopilotMode = (on: boolean) => post("/api/autopilot", { on });

// Elon Mode — ruthless autopilot: bypasses ALL ask-first gates. Deletes go to a 30-day trash bin;
// outward actions (send/post/pay) are NOT recoverable. Dangerous — gated behind a confirm in the UI.
export const setElonMode = (on: boolean) => post("/api/admin/elon-mode", { on });

// Import a pasted ChatGPT/Claude/Gemini history → extract durable facts into SAM's memory.
export const importContext = (name: string, externalContext: string) =>
  post("/api/admin/import-context", { name, externalContext });

// ── The Continuous Swarm ──
export interface SwarmAgent { id: string; specialistId: string; name: string; emoji: string; task: string; status: "pending" | "running" | "paused" | "done" | "error"; output?: string; pendingActivity?: string; pendingTool?: string; pendingPreview?: string; }
export interface Swarm { id: string; goal: string; status: "planning" | "running" | "paused" | "done" | "error"; agents: SwarmAgent[]; synthesis?: string; created: number; }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!r.ok) throw new Error(`API failed: ${path}`);
  return r.json();
}

export interface MemoryItem { id: string; text: string; ts: number }
export interface MemoryData { groups: Record<string, MemoryItem[]>; count: number; private: boolean; note: string }
// "What SAM remembers about you" — the real learned memory (facts/plans/decisions/open loops), 100% local.
export async function getMemory() { return api<MemoryData>(`/api/memory?user=${encodeURIComponent(USER.name || "")}`); }
export async function forgetMemory(id: string) { return api<{ ok: boolean }>("/api/memory/forget", { method: "POST", body: JSON.stringify({ id }) }); }
// Export your memory as Markdown (100% local) and wipe it (scoped to you).
export async function exportMemory() { return api<{ markdown: string }>(`/api/memory/export?user=${encodeURIComponent(USER.name || "")}`); }
export async function clearMemory() { return api<{ ok: boolean; cleared: number }>("/api/memory/clear", { method: "POST", body: JSON.stringify({ user: USER.name || "" }) }); }

export async function getSwarms() { return api<any>("/api/swarms"); }
export async function startSwarm(goal: string, projectId?: string, tier?: "local"|"free"|"premium") {
  return api<any>("/api/swarms", { method: "POST", body: JSON.stringify({ goal, projectId, tier }) });
}
export async function approveSwarmAgent(swarmId: string, agentId: string, approved: boolean) {
  return api<any>("/api/swarms/approve", { method: "POST", body: JSON.stringify({ swarmId, agentId, approved }) });
}

export interface Schedule {
  id: string; command: string; cron: string; enabled: boolean;
  lastRun?: string; lastResult?: string; created: string; runCount: number;
  // A7 — computed server-side, same zone-correct math the scheduler fires from.
  nextRun?: number | null; stale?: boolean;
}
export async function getSchedules() { return api<Schedule[]>("/api/schedules"); }
export async function addSchedule(command: string, cron: string) { return api<Schedule>("/api/schedules", { method: "POST", body: JSON.stringify({ command, cron }) }); }
export async function removeSchedule(id: string) { return api<{ok: boolean}>(`/api/schedules/${id}`, { method: "DELETE" }); }
export async function toggleSchedule(id: string) { return api<Schedule>(`/api/schedules/${id}/toggle`, { method: "POST" }); }

// People SAM knows by sight (face memory).
export const getPeople = () => get("/api/people");

// ── 📓 Notebooks (NotebookLM) ──
export const listNotebooks = () => get("/api/notebooks");
export const createNotebook = (title: string) => post("/api/notebooks", { title });
export const notebookSources = (id: string) => get(`/api/notebooks/${encodeURIComponent(id)}/sources`);
export const addNotebookSource = (id: string, body: { url?: string; file?: string; text?: string; title?: string }) => post(`/api/notebooks/${encodeURIComponent(id)}/source`, body);
export const askNotebook = (id: string, question: string) => post(`/api/notebooks/${encodeURIComponent(id)}/ask`, { question });
export const notebookAudio = (id: string) => post(`/api/notebooks/${encodeURIComponent(id)}/audio`);
export const deleteNotebook = (id: string) => del(`/api/notebooks/${encodeURIComponent(id)}`);

// 🚀 Sign & ship
export const getSigningStatus = () => get("/api/signing/status");
export const genAndroidKeystore = () => post("/api/signing/android-keystore");

// ── THE TWO CHECKED CARRIERS ──
//
// `.then((r) => r.json())` does not fail on a failed request. fetch only rejects on a network
// error, so a 401/403/500 resolves happily with the server's error body, and the caller reads it
// as data. 47 mutating helpers were built that way, which means the UI reported success for
// actions the server had REFUSED: "Disable all consents" said done while consent stayed on;
// revokeDevice said revoked while the device stayed paired; safeLock said locked while the vault
// stayed open. That is SAM's #1 historical failure class — an operation that succeeds while
// changing nothing — reached through the one path nothing was checking.
//
// apiError() (above) already existed to prevent exactly this, and reached 3 of 58 helpers. These
// two carriers put every one of them behind it. They THROW, matching api()'s existing contract,
// so a refusal cannot be mistaken for a result by anything downstream.
async function checked(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) throw await apiError(res);
  return res.json().catch(() => ({}));   // 204/empty body is a success, not a parse failure
}
export const get = (url: string) => checked(url);
export const del = (url: string) => checked(url, { method: "DELETE" });
const post = (url: string, body?: any) =>
  checked(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
export const getConsent = () => get("/api/consent");
export const setConsent = (behavior: string, on: boolean) => post("/api/consent", { behavior, on });
export const consentDisableAll = () => post("/api/consent/disable-all");
export const getAutonomyLog = () => get("/api/autonomy-log");
export const clearAutonomyLog = () => post("/api/autonomy-log/clear");
export const getSuggestions = () => get("/api/suggestions");
export const getPreferences = () => get("/api/preferences");
export const learnPreference = (key: string, value: string) => post("/api/preferences/learn", { key, value });
export const forgetPreference = (key: string) => post("/api/preferences/forget", { key });
export const resetPreferences = () => post("/api/preferences/reset");
export const getWorkflows = () => get("/api/workflows");
// ── Routines — bind a spoken/typed phrase to a saved workflow (fires ahead of the brain) ──
export const getRoutines = () => get("/api/routines");
export const bindRoutine = (workflowId: string, phrases: string[]) => post("/api/routines/bind", { workflowId, phrases });
export const unbindRoutine = (workflowId: string) => post("/api/routines/unbind", { workflowId });
export const installStarterWorkflows = () => post("/api/workflows/install-starters");
export const runWorkflowApi = (id: string) => post(`/api/workflows/${id}/run`);
export const deleteWorkflowApi = (id: string) => del(`/api/workflows/${id}`);

// ── the Safe — encrypted secret store (all routes loopback + Handshake gated; token attached by the
//    fetch shim). Responses never contain a secret VALUE — names, counts, and typed error kinds only. ──
export const getSafeStatus = () => get("/api/safe/status");
export const getSafeMigratePreview = () => get("/api/safe/migrate/preview");
export const safeSetup = (passphrase: string | undefined, useKeychain: boolean) => post("/api/safe/setup", { passphrase: passphrase || undefined, useKeychain });
export const safeUnlock = (passphrase?: string) => post("/api/safe/unlock", { passphrase: passphrase || undefined });
export const safeMigrate = () => post("/api/safe/migrate");
export const safeLock = () => post("/api/safe/lock");

// ── v2.0 — measurement (local analytics + opt-in telemetry) ──
export const getAnalytics = () => get("/api/analytics");
export const resetAnalytics = () => post("/api/analytics/reset");
export const getTelemetry = () => get("/api/telemetry");
export const setTelemetry = (on: boolean) => post("/api/telemetry", { on });
export const getTelemetryPreview = () => get("/api/telemetry/preview");

export const getDoctor = () => get("/api/doctor");
// A refused read is NOT an absent rig. Reported separately so the desk can say which,
// rather than telling you FLIP IT is not installed while it sits there on disk.
export const getFlipit = () => fetch("/api/flipit").then(async (r) => {
  if (r.status === 403) return { present: false, refused: true };
  return r.json();
});
export const getStanding = () => get("/api/standing");
export const standingArm = (specialistId: string, task: string, cron: string) => post("/api/standing/arm", { specialistId, task, cron });
export const standingDisarm = (id: string) => post("/api/standing/disarm", { id });
export const standingRearm = (id: string) => post("/api/standing/rearm", { id });
export const standingRemove = (id: string) => post("/api/standing/remove", { id });

// ── the Chime — alarms + named timers ──
export const getChimes = () => get("/api/chimes");
export const setChimeTimer = (label: string, afterMs: number) => post("/api/chime", { kind: "timer", label, afterMs });
export const setChimeAlarm = (label: string, at: string, recur?: string) => post("/api/chime", { kind: "alarm", label, at, recur });
export const cancelChimeApi = (id: string) => post("/api/chime/cancel", { id });
export const snoozeChimeApi = (id: string, ms?: number) => post("/api/chime/snooze", { id, ms });

// ── the Watch — local-only cameras ──
export const getCameras = () => get("/api/cameras");
export const addCameraApi = (c: { name: string; location?: string; kind: "snapshot" | "rtsp" | "ring"; url?: string }) => post("/api/cameras", c);
export const removeCameraApi = (id: string) => post("/api/cameras/remove", { id });

// ── the yard — long-running build jobs (loopback, or a paired device) ──
// A refused read is not an off yard — reported separately so the Tasks view can tell
// "pair this device" apart from "nothing has run yet".
export const getYard = () => fetch("/api/yard").then(async (r) => {
  if (r.status === 403) return { on: false, refused: true, recent: [] };
  return r.json();
});
export const getYardJob = (id: string) => get(`/api/yard/job/${encodeURIComponent(id)}`);
// What a job actually changed. An auto-applied edit stays inspectable afterwards rather
// than being something you have to take on trust.
export const getYardJobDiffs = (id: string) =>
  fetch(`/api/yard/job/${encodeURIComponent(id)}/diffs`)
    .then((r) => (r.ok ? r.json() : { diffs: [] }))
    .catch(() => ({ diffs: [] }));
export const enqueueYardJob = async (kind: string, payload: any = {}, opts: { budget?: number; project?: string } = {}) => {
  const pair = pairToken();
  const r = await fetch("/api/yard/enqueue", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(pair ? { "X-SAM-Pair": pair } : {}) },
    body: JSON.stringify({ kind, payload, ...opts }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `couldn't start that job (${r.status})`);
  return body;
};

// ── the Playbook — saved, parameterised prompts, one tap to run ──
const yardPost = async (path: string, body: any, method: "POST" | "DELETE" = "POST") => {
  const pair = pairToken();
  const r = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...(pair ? { "X-SAM-Pair": pair } : {}) },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out?.error || `that didn't work (${r.status})`);
  return out;
};
export const getPlaybooks = () => fetch("/api/playbooks").then(async (r) => {
  if (r.status === 403) return { playbooks: [], refused: true };
  return r.json();
});
export const getPlaybook = (id: string) => get(`/api/playbooks/${encodeURIComponent(id)}`);
export const savePlaybook = (input: { id?: string; name: string; template: string }) => yardPost("/api/playbooks", input);
export const deletePlaybook = (id: string) => yardPost(`/api/playbooks/${encodeURIComponent(id)}`, null, "DELETE");
export const importPlaybook = (text: string, filename?: string) => yardPost("/api/playbooks/import", { text, filename });
export const runPlaybook = (id: string, values: Record<string, string>) => yardPost(`/api/playbooks/${encodeURIComponent(id)}/run`, { values });

// Surfaces the server's reason instead of failing silently. Starting and stopping work
// needs the passkey the desktop app carries, so this legitimately refuses in a browser —
// and a button that does nothing without saying why is the worst version of that.
// ── pairing a browser with the yard ──
// The token lives in this browser's own storage and is sent only on yard writes. It is
// not the Handshake passkey and cannot stand in for it anywhere else.
const PAIR_KEY = "sam.yard.pair";
export const pairToken = () => { try { return localStorage.getItem(PAIR_KEY) || ""; } catch { return ""; } };
export const setPairToken = (t: string) => { try { localStorage.setItem(PAIR_KEY, t); } catch { /* private mode — pairing simply will not stick */ } };
export const clearPairToken = () => { try { localStorage.removeItem(PAIR_KEY); } catch { /* nothing to clear */ } };

// Ungated on purpose — a browser must be able to learn that pairing is what it needs.
export const pairStatus = () => get("/api/pair/status");
export const requestYardPairing = (label: string) => post("/api/yard/pair/request", { label });
export const collectYardPairing = (id: string) => get(`/api/yard/pair/collect?id=${encodeURIComponent(id)}`);
export const yardPairPending = () => fetch("/api/yard/pair/pending").then((r) => (r.ok ? r.json() : { pending: [], paired: [], notApp: true }));
export const approveYardPairing = (id: string, code: string) => post("/api/yard/pair/approve", { id, code });
export const denyYardPairing = (id: string) => post("/api/yard/pair/deny", { id });
export const revokeYardPairing = (id: string) => post("/api/yard/pair/revoke", { id });

// B2 — the device registry (the NEW session-cookie Pairing from server/pairing.ts —
// distinct from the yard-specific request/approve pairing above).
export type Grant = "deploy" | "shellExec" | "spendAbove";
export interface PairedDevice { id: string; created: number; lastSeen: number; label: string; grants: Partial<Record<Grant, boolean>> }
export const getPairedDevices = () => fetch("/api/pair/devices").then(async (r) => {
  if (r.status === 403) return { devices: [], refused: true };
  return r.json() as Promise<{ devices: PairedDevice[]; refused?: boolean }>;
});
export const revokeDevice = (id: string) => post(`/api/pair/devices/${encodeURIComponent(id)}/revoke`, {});
export const revokeAllDevices = () => post("/api/pair/revoke-all", {});
// Mint a pairing code for a phone. The endpoint has existed since the Pairing shipped and
// NOTHING has ever called it — its only references in the repo were its own definition and its
// guard test. So the one way to pair a phone was a line the server printed to stdout on boot,
// once, valid fifteen minutes, and only when no session existed yet. The Pocket's own pairing
// screen meanwhile told people to "open SAM and choose Pair a device", which was never built.
//
// Reachable from HERE and only here for a good reason: /api/pair/new is isTrustedLocal, meaning
// loopback AND the per-launch passkey. The desktop renderer is the one caller that holds it
// (electron/preload.ts → the fetch shim in main.tsx attaches X-SAM-Token to every /api call), so
// inviting a device stays a power of the machine SAM runs on rather than of anything that can
// reach the port.
export const pairNew = (): Promise<{ url?: string; expiresInSec?: number; pin?: string; pinExpiresInSec?: number; error?: string }> =>
  post("/api/pair/new", {});
// B3 — capability tiers. Loopback-only server-side (grants can't be self-elevated from a
// remote device) — this call will 403 from anywhere but the Mac itself, by design.
export const setDeviceGrants = (id: string, grants: Partial<Record<Grant, boolean>>) =>
  post(`/api/pair/devices/${encodeURIComponent(id)}/grants`, { grants });

// B5 — "what did the phone do yesterday." deviceId scopes to one device; hours defaults
// to 24 (literally "yesterday") on the server if omitted.
export type AttrCapability = "assign-task" | "cancel" | "retry" | "raise-budget" | "revoke-device" | "set-grants";
export interface ActivityEntry { at: string; deviceId: string; deviceLabel: string; capability: AttrCapability; detail: string }
export const getDeviceActivity = (opts: { deviceId?: string; hours?: number } = {}) => {
  const q = new URLSearchParams();
  if (opts.deviceId) q.set("deviceId", opts.deviceId);
  if (opts.hours) q.set("hours", String(opts.hours));
  return fetch(`/api/pair/activity?${q.toString()}`).then(async (r) => {
    if (r.status === 403) return { activity: [], refused: true };
    return r.json() as Promise<{ activity: ActivityEntry[]; refused?: boolean }>;
  });
};

export const cancelYardJob = async (id: string) => {
  const pair = pairToken();
  const r = await fetch("/api/yard/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(pair ? { "X-SAM-Pair": pair } : {}) },
    body: JSON.stringify({ id }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `couldn't stop that job (${r.status})`);
  return body;
};
export const retryYardJob = (id: string) => post("/api/yard/retry", { id });
export const raiseYardJobBudget = async (id: string, budget: number) => {
  const pair = pairToken();
  const r = await fetch("/api/yard/raise-budget", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(pair ? { "X-SAM-Pair": pair } : {}) },
    body: JSON.stringify({ id, budget }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `couldn't raise that budget (${r.status})`);
  return body;
};

// ── what the yard has built ──
// A refused read is not an empty yard. Reported separately so the view can say which,
// rather than announcing "nothing built yet" while two projects sit on disk.
export const getYardProjects = () => fetch("/api/yard/projects").then(async (r) => {
  if (r.status === 403) return { projects: [], refused: true };
  return r.json();
});
export const getYardProject = (slug: string) => get(`/api/yard/projects/${encodeURIComponent(slug)}`);
export const getYardProjectFile = (slug: string, path: string) =>
  get(`/api/yard/projects/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`);
export const yardPreviewUrl = (slug: string) => `/api/yard/preview/${encodeURIComponent(slug)}/`;
// A5 — one specific file's URL (image preview, download). Encode each path SEGMENT, not
// the whole path — encoding "/" itself would break the route's wildcard match.
export const yardFileUrl = (slug: string, path: string) =>
  yardPreviewUrl(slug) + String(path).split("/").map(encodeURIComponent).join("/");

// ── CONNECTORS — the services SAM reads (GitHub, Slack, Notion, Linear, Vercel) ──
// Every list answers the same { rows } shape, so this client is four lines and the pane that
// uses it has no per-service branches at all.
export interface ConnectorList { kind: string; label: string; hint: string; param?: string; drill?: string }
export interface ConnectorStatus {
  id: string; label: string; note: string; url: string; configKey?: string;
  connected: boolean;
  /** The one failure a paste can fix. An outage sets `error` and leaves this false. */
  needsToken: boolean;
  detail?: string; error?: string;
  lists: ConnectorList[];
}
export interface ConnectorRow { id: string; title: string; sub?: string; url?: string }

export const getConnectors = (refresh = false) =>
  get(`/api/connectors${refresh ? "?refresh=1" : ""}`)
    .then((j) => (j?.connectors || []) as ConnectorStatus[]);

// Surfaces the server's own sentence — "that Slack token was rejected" and "Slack did not answer
// in time" send the operator to different places, and a generic "failed to load" sends them nowhere.
export const getConnectorRows = (id: string, kind: string, param?: string) => {
  const q = param ? `?param=${encodeURIComponent(param)}` : "";
  return fetch(`/api/connectors/${encodeURIComponent(id)}/${encodeURIComponent(kind)}${q}`).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `could not read ${id}`);
    return (j?.rows || []) as ConnectorRow[];
  });
};
