// ─────────────────────────────────────────────────────────────
//  S.A.M. · WEB PUSH — SAM reaches your phone even when closed
//  Morning brief, reminders, Guardian & scheduled-task results are
//  pushed to any device that opted in (installed PWA, iOS 16.4+ or
//  Android). VAPID keys are generated once and kept in the vault
//  (local, gitignored). No third party — SAM pushes direct.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import webpush from "web-push";
import { scrub, collapseHomes } from "./scrub.ts";

const VAULT = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const KEYS = join(VAULT, "push-keys.json");
const SUBS = join(VAULT, "push-subs.json");

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };

function load<T>(p: string, fallback: T): T { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback; } catch { return fallback; } }
// AUDIT FIX: atomic (temp+rename, no truncation on crash) + optional 0600. push-keys.json holds the
// VAPID PRIVATE key — a crash mid-write would corrupt it and invalidate every subscription, and it
// must not be world-readable.
function saveJson(p: string, v: unknown, mode?: number) { try { writeFileAtomic(p, JSON.stringify(v), mode !== undefined ? { mode } : {}); } catch { /* ignore */ } }

// Generate the VAPID keypair once, reuse forever (so existing subscriptions stay valid).
let keys = load<{ publicKey: string; privateKey: string } | null>(KEYS, null);
if (!keys?.publicKey) { keys = webpush.generateVAPIDKeys(); saveJson(KEYS, keys, 0o600); }
webpush.setVapidDetails("mailto:sam@localhost", keys!.publicKey, keys!.privateKey);

export function vapidPublicKey(): string { return keys!.publicKey; }

let subs: Sub[] = load<Sub[]>(SUBS, []);

export function addSubscription(sub: Sub): boolean {
  if (!sub?.endpoint || !sub?.keys?.p256dh) return false;
  if (!subs.some((s) => s.endpoint === sub.endpoint)) { subs.push(sub); saveJson(SUBS, subs); }
  return true;
}
export function subscriberCount(): number { return subs.length; }

// B4 — a push notification sits on a lock screen anyone nearby can glance at, not just the
// operator. Every body that reaches sendNotification runs through the same scrubber the
// logs use (server/scrub.ts) — defense in depth for anything credential-shaped that
// shouldn't be there regardless of source. The real discipline is upstream, though: a
// caller should hand this a short STRUCTURAL summary ("Task finished — <name>"), never the
// actual content of what SAM said, found, or produced. summarize() below is that helper.
export function summarize(label: string, maxLen = 100): string {
  return collapseHomes(scrub(String(label || ""))).slice(0, maxLen);
}

// Fire-and-forget push to every subscribed device; prunes dead endpoints (404/410).
export async function pushNotify(title: string, body: string, url = "/"): Promise<void> {
  if (!subs.length) return;
  const safeBody = collapseHomes(scrub((body || "").replace(/[#*`>]/g, ""))).slice(0, 220);
  const payload = JSON.stringify({ title, body: safeBody, url });
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s as any, payload); }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) { subs = subs.filter((s) => !dead.includes(s.endpoint)); saveJson(SUBS, subs); }
}
