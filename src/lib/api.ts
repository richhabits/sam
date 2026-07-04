// Thin client — Vite proxies /api to the SAM brain on :8787

export interface AgentResult {
  kind: "final" | "pending";
  text?: string;
  trace: string[];
  provider?: string;
  // pending (a risky action awaiting approval):
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

export interface UserProfile { name?: string; about?: string }
let USER: UserProfile = {};
export function setUser(u: UserProfile) { USER = u || {}; }

export interface Attachment { kind: "image" | "text"; name: string; mime?: string; data?: string; text?: string }

export async function command(message: string, projectId?: string, tier?: string, signal?: AbortSignal, attachments?: Attachment[]): Promise<AgentResult> {
  const res = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, projectId, tier, user: USER, attachments }),
    signal,
  });
  if (!res.ok) throw new Error("command failed");
  return res.json();
}

// Approve (or decline) a pending risky action and continue the agent.
// `always` = "yes, and always allow this action" (standing authorization).
export async function confirm(pending: AgentResult, approved: boolean, always = false): Promise<AgentResult> {
  const res = await fetch("/api/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: pending.message, projectId: pending.projectId, tier: pending.tier,
      transcript: pending.transcript, tool: pending.tool, input: pending.input,
      trace: pending.trace, approved, always, user: USER,
    }),
  });
  if (!res.ok) throw new Error("confirm failed");
  return res.json();
}

// Streaming command — calls onEvent for each {type: token|tool|pending|done} event.
export async function streamCommand(message: string, projectId: string | undefined, tier: string | undefined, onEvent: (e: any) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/stream", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, projectId, tier, user: USER }), signal,
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
      try { onEvent(JSON.parse(line.slice(5).trim())); } catch {}
    }
  }
}

// Standing authorizations
export const getAllowed = () => fetch("/api/allow").then((r) => r.json());
export const setAllow = (tool: string, on: boolean) =>
  fetch("/api/allow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, on }) }).then((r) => r.json());

export const getProjects = () => fetch("/api/projects").then((r) => r.json());
export const getSkills = () => fetch("/api/skills").then((r) => r.json());
export const getLog = () => fetch("/api/vault/log").then((r) => r.json());
export const getStatus = () => fetch("/api/status").then((r) => r.json());
export const getTools = () => fetch("/api/tools").then((r) => r.json());

// Admin — manage provider API keys (rolling pools) + config from the app.
export const getAdminConfig = () => fetch("/api/admin/config").then((r) => r.json());
export const saveKeys = (provider: string, keys: string) =>
  fetch("/api/admin/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, keys }) }).then((r) => r.json());
export const saveConfig = (key: string, value: string) =>
  fetch("/api/admin/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) }).then((r) => r.json());
