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
  if (!res.ok) throw new Error("command failed");
  return res.json();
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
export const getAllowed = () => fetch("/api/allow").then((r) => r.json());
export const setAllow = (tool: string, on: boolean) =>
  fetch("/api/allow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, on }) }).then((r) => r.json());

export const getProjects = () => fetch("/api/projects").then((r) => r.json());
export const getLog = () => fetch("/api/vault/log").then((r) => r.json());
export const getStatus = () => fetch("/api/status").then((r) => r.json());
export const getQuotes = (symbols: string) =>
  fetch(`/api/quotes?symbols=${encodeURIComponent(symbols)}`).then((r) => r.json());
export const runArena = (prompt?: string) =>
  fetch("/api/arena", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) }).then((r) => r.json());
export const getArena = () => fetch("/api/arena").then((r) => r.json());
export const clearArena = () => fetch("/api/arena", { method: "DELETE" }).then((r) => r.json());
export const getTools = () => fetch("/api/tools").then((r) => r.json());

// Admin — manage provider API keys (rolling pools) + config from the app.
export const getAdminConfig = () => fetch("/api/admin/config").then((r) => r.json());
export const saveKeys = (provider: string, keys: string) =>
  fetch("/api/admin/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, keys }) }).then((r) => r.json());
export const saveConfig = (key: string, value: string) =>
  fetch("/api/admin/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) }).then((r) => r.json());
export const getMcpPresets = () => fetch("/api/mcp/presets").then((r) => r.json());
export const configureMcp = (id: string, env: Record<string,string>) => fetch("/api/mcp/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, env }) }).then((r) => r.json());
export const removeMcp = (id: string) => fetch("/api/mcp/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then((r) => r.json());
export const getPhoneLink = () => fetch("/api/phone-link").then((r) => r.json());
export const regeneratePhone = () => fetch("/api/phone-regenerate", { method: "POST" }).then((r) => r.json());
export const disablePhone = () => fetch("/api/phone-disable", { method: "POST" }).then((r) => r.json());
export const enablePhone = () => fetch("/api/phone-enable", { method: "POST" }).then((r) => r.json());
export const testEmail = (): Promise<{ ok: boolean; error?: string }> =>
  fetch("/api/admin/test-email", { method: "POST" }).then((r) => r.json());

// Self-update — SAM checks the repo and can pull the latest (evolve, for free).
export async function checkUpdate(): Promise<{ behind: boolean; current?: string; latest?: string; url?: string }> {
  try { const r = await fetch("/api/update-check"); return await r.json(); } catch { return { behind: false }; }
}
export async function runUpdate(): Promise<{ ok: boolean; output?: string; error?: string }> {
  try { const r = await fetch("/api/update", { method: "POST" }); return await r.json(); } catch (e: any) { return { ok: false, error: String(e) }; }
}

// Security watchdog status (Jeeves on the door).
export async function getSecurity(): Promise<{ status: any; events: any[] }> {
  try { const r = await fetch("/api/security"); return await r.json(); } catch { return { status: { clear: true, headline: "—" }, events: [] }; }
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
export const getRoster = () => fetch("/api/team/roster").then((r) => r.json());

// Autopilot — SAM lifts the silly work autonomously (serious actions still ask).
export const getAutopilot = () => fetch("/api/autopilot").then((r) => r.json());
export const setAutopilotMode = (on: boolean) => fetch("/api/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) }).then((r) => r.json());

// Elon Mode — ruthless autopilot: bypasses ALL ask-first gates. Deletes go to a 30-day trash bin;
// outward actions (send/post/pay) are NOT recoverable. Dangerous — gated behind a confirm in the UI.
export const setElonMode = (on: boolean) => fetch("/api/admin/elon-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) }).then((r) => r.json());

// Import a pasted ChatGPT/Claude/Gemini history → extract durable facts into SAM's memory.
export const importContext = (name: string, externalContext: string) =>
  fetch("/api/admin/import-context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, externalContext }) }).then((r) => r.json());

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
}
export async function getSchedules() { return api<Schedule[]>("/api/schedules"); }
export async function addSchedule(command: string, cron: string) { return api<Schedule>("/api/schedules", { method: "POST", body: JSON.stringify({ command, cron }) }); }
export async function removeSchedule(id: string) { return api<{ok: boolean}>(`/api/schedules/${id}`, { method: "DELETE" }); }
export async function toggleSchedule(id: string) { return api<Schedule>(`/api/schedules/${id}/toggle`, { method: "POST" }); }

// People SAM knows by sight (face memory).
export const getPeople = () => fetch("/api/people").then((r) => r.json());

// ── 📓 Notebooks (NotebookLM) ──
export const listNotebooks = () => fetch("/api/notebooks").then((r) => r.json());
export const createNotebook = (title: string) => fetch("/api/notebooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }).then((r) => r.json());
export const notebookSources = (id: string) => fetch(`/api/notebooks/${encodeURIComponent(id)}/sources`).then((r) => r.json());
export const addNotebookSource = (id: string, body: { url?: string; file?: string; text?: string; title?: string }) => fetch(`/api/notebooks/${encodeURIComponent(id)}/source`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
export const askNotebook = (id: string, question: string) => fetch(`/api/notebooks/${encodeURIComponent(id)}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) }).then((r) => r.json());
export const notebookAudio = (id: string) => fetch(`/api/notebooks/${encodeURIComponent(id)}/audio`, { method: "POST" }).then((r) => r.json());
export const deleteNotebook = (id: string) => fetch(`/api/notebooks/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => r.json());

// 🚀 Sign & ship
export const getSigningStatus = () => fetch("/api/signing/status").then((r) => r.json());
export const genAndroidKeystore = () => fetch("/api/signing/android-keystore", { method: "POST" }).then((r) => r.json());

// ── v1.8 — autonomy consent, learning, workflows ──
const post = (url: string, body?: any) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
export const getConsent = () => fetch("/api/consent").then((r) => r.json());
export const setConsent = (behavior: string, on: boolean) => post("/api/consent", { behavior, on });
export const consentDisableAll = () => post("/api/consent/disable-all");
export const getAutonomyLog = () => fetch("/api/autonomy-log").then((r) => r.json());
export const clearAutonomyLog = () => post("/api/autonomy-log/clear");
export const getSuggestions = () => fetch("/api/suggestions").then((r) => r.json());
export const getPreferences = () => fetch("/api/preferences").then((r) => r.json());
export const forgetPreference = (key: string) => post("/api/preferences/forget", { key });
export const resetPreferences = () => post("/api/preferences/reset");
export const getWorkflows = () => fetch("/api/workflows").then((r) => r.json());
// ── Routines — bind a spoken/typed phrase to a saved workflow (fires ahead of the brain) ──
export const getRoutines = () => fetch("/api/routines").then((r) => r.json());
export const bindRoutine = (workflowId: string, phrases: string[]) => post("/api/routines/bind", { workflowId, phrases });
export const unbindRoutine = (workflowId: string) => post("/api/routines/unbind", { workflowId });
export const installStarterWorkflows = () => post("/api/workflows/install-starters");
export const runWorkflowApi = (id: string) => post(`/api/workflows/${id}/run`);
export const deleteWorkflowApi = (id: string) => fetch(`/api/workflows/${id}`, { method: "DELETE" }).then((r) => r.json());

// ── the Safe — encrypted secret store (all routes loopback + Handshake gated; token attached by the
//    fetch shim). Responses never contain a secret VALUE — names, counts, and typed error kinds only. ──
export const getSafeStatus = () => fetch("/api/safe/status").then((r) => r.json());
export const getSafeMigratePreview = () => fetch("/api/safe/migrate/preview").then((r) => r.json());
export const safeSetup = (passphrase: string | undefined, useKeychain: boolean) => post("/api/safe/setup", { passphrase: passphrase || undefined, useKeychain });
export const safeUnlock = (passphrase?: string) => post("/api/safe/unlock", { passphrase: passphrase || undefined });
export const safeMigrate = () => post("/api/safe/migrate");
export const safeLock = () => post("/api/safe/lock");

// ── v2.0 — measurement (local analytics + opt-in telemetry) ──
export const getAnalytics = () => fetch("/api/analytics").then((r) => r.json());
export const resetAnalytics = () => post("/api/analytics/reset");
export const getTelemetry = () => fetch("/api/telemetry").then((r) => r.json());
export const setTelemetry = (on: boolean) => post("/api/telemetry", { on });
export const getTelemetryPreview = () => fetch("/api/telemetry/preview").then((r) => r.json());

export const getDoctor = () => fetch("/api/doctor").then((r) => r.json());
// A refused read is NOT an absent rig. Reported separately so the desk can say which,
// rather than telling you FLIP IT is not installed while it sits there on disk.
export const getFlipit = () => fetch("/api/flipit").then(async (r) => {
  if (r.status === 403) return { present: false, refused: true };
  return r.json();
});
export const getStanding = () => fetch("/api/standing").then((r) => r.json());
export const standingArm = (specialistId: string, task: string, cron: string) => post("/api/standing/arm", { specialistId, task, cron });
export const standingDisarm = (id: string) => post("/api/standing/disarm", { id });
export const standingRearm = (id: string) => post("/api/standing/rearm", { id });
export const standingRemove = (id: string) => post("/api/standing/remove", { id });

// ── the Chime — alarms + named timers ──
export const getChimes = () => fetch("/api/chimes").then((r) => r.json());
export const setChimeTimer = (label: string, afterMs: number) => post("/api/chime", { kind: "timer", label, afterMs });
export const setChimeAlarm = (label: string, at: string, recur?: string) => post("/api/chime", { kind: "alarm", label, at, recur });
export const cancelChimeApi = (id: string) => post("/api/chime/cancel", { id });
export const snoozeChimeApi = (id: string, ms?: number) => post("/api/chime/snooze", { id, ms });

// ── the Watch — local-only cameras ──
export const getCameras = () => fetch("/api/cameras").then((r) => r.json());
export const addCameraApi = (c: { name: string; location?: string; kind: "snapshot" | "rtsp" | "ring"; url?: string }) => post("/api/cameras", c);
export const removeCameraApi = (id: string) => post("/api/cameras/remove", { id });

// ── the yard — long-running build jobs (loopback + Handshake) ──
export const getYard = () => fetch("/api/yard").then((r) => r.json());
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

export const requestYardPairing = (label: string) => post("/api/yard/pair/request", { label });
export const collectYardPairing = (id: string) => fetch(`/api/yard/pair/collect?id=${encodeURIComponent(id)}`).then((r) => r.json());
export const yardPairPending = () => fetch("/api/yard/pair/pending").then((r) => (r.ok ? r.json() : { pending: [], paired: [], notApp: true }));
export const approveYardPairing = (id: string, code: string) => post("/api/yard/pair/approve", { id, code });
export const denyYardPairing = (id: string) => post("/api/yard/pair/deny", { id });
export const revokeYardPairing = (id: string) => post("/api/yard/pair/revoke", { id });

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

// ── what the yard has built ──
// A refused read is not an empty yard. Reported separately so the view can say which,
// rather than announcing "nothing built yet" while two projects sit on disk.
export const getYardProjects = () => fetch("/api/yard/projects").then(async (r) => {
  if (r.status === 403) return { projects: [], refused: true };
  return r.json();
});
export const getYardProject = (slug: string) => fetch(`/api/yard/projects/${encodeURIComponent(slug)}`).then((r) => r.json());
export const getYardProjectFile = (slug: string, path: string) =>
  fetch(`/api/yard/projects/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`).then((r) => r.json());
export const yardPreviewUrl = (slug: string) => `/api/yard/preview/${encodeURIComponent(slug)}/`;
