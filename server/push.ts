// ─────────────────────────────────────────────────────────────
//  S.A.M. · WEB PUSH — SAM reaches your phone even when closed
//  Morning brief, reminders, Guardian & scheduled-task results are
//  pushed to any device that opted in (installed PWA, iOS 16.4+ or
//  Android). VAPID keys are generated once and kept in the vault
//  (local, gitignored). No third party — SAM pushes direct.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import webpush from "web-push";

const VAULT = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const KEYS = join(VAULT, "push-keys.json");
const SUBS = join(VAULT, "push-subs.json");

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };

function load<T>(p: string, fallback: T): T { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback; } catch { return fallback; } }
function saveJson(p: string, v: unknown) { try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v)); } catch { /* ignore */ } }

// Generate the VAPID keypair once, reuse forever (so existing subscriptions stay valid).
let keys = load<{ publicKey: string; privateKey: string } | null>(KEYS, null);
if (!keys?.publicKey) { keys = webpush.generateVAPIDKeys(); saveJson(KEYS, keys); }
webpush.setVapidDetails("mailto:sam@localhost", keys!.publicKey, keys!.privateKey);

export function vapidPublicKey(): string { return keys!.publicKey; }

let subs: Sub[] = load<Sub[]>(SUBS, []);

export function addSubscription(sub: Sub): boolean {
  if (!sub?.endpoint || !sub?.keys?.p256dh) return false;
  if (!subs.some((s) => s.endpoint === sub.endpoint)) { subs.push(sub); saveJson(SUBS, subs); }
  return true;
}
export function subscriberCount(): number { return subs.length; }

// Fire-and-forget push to every subscribed device; prunes dead endpoints (404/410).
export async function pushNotify(title: string, body: string, url = "/"): Promise<void> {
  if (!subs.length) return;
  const payload = JSON.stringify({ title, body: (body || "").replace(/[#*`>]/g, "").slice(0, 220), url });
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s as any, payload); }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) { subs = subs.filter((s) => !dead.includes(s.endpoint)); saveJson(SUBS, subs); }
}
