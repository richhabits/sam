// ─────────────────────────────────────────────────────────────
//  S.A.M. · WEB PUSH — SAM reaches your phone even when closed
//  Morning brief, reminders, Guardian & scheduled-task results are
//  pushed to any device that opted in (installed PWA, iOS 16.4+ or
//  Android). VAPID keys are generated once and kept in the vault
//  (local, gitignored). No third party — SAM pushes direct.
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";
import { writeFileAtomic } from "./atomic.ts";
import { collapseHomes, scrub } from "./scrub.ts";

const VAULT = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const KEYS = join(VAULT, "push-keys.json");
const SUBS = join(VAULT, "push-subs.json");

type WebSub = { endpoint: string; keys: { p256dh: string; auth: string } };
type ExpoSub = { expoPushToken: string };
type Sub = WebSub | ExpoSub;

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

// Bounds on what a subscribe call may store. Any paired device can POST here, the body limit is 30mb,
// and every stored endpoint becomes a URL this server POSTs to on each notification — so: https
// only, short fields, only the fields web-push needs (the old code stored the whole body verbatim),
// and a cap on the list so the file and the fan-out cannot grow without limit.
const MAX_SUBS = 50;
const short = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export function addSubscription(sub: Sub): boolean {
  if (!sub || typeof sub !== "object") return false;
  if ("expoPushToken" in sub && typeof sub.expoPushToken === "string") {
    if (!short(sub.expoPushToken, 200)) return false;
    if (!subs.some((s) => "expoPushToken" in s && s.expoPushToken === sub.expoPushToken)) {
      if (subs.length >= MAX_SUBS) return false;
      subs.push({ expoPushToken: sub.expoPushToken }); saveJson(SUBS, subs);
    }
    return true;
  }
  if (!("endpoint" in sub) || !short(sub.endpoint, 2048) || !short(sub.keys?.p256dh, 256) || !short(sub.keys?.auth, 256)) return false;
  let url: URL;
  try { url = new URL(sub.endpoint); } catch { return false; }
  if (url.protocol !== "https:") return false;
  if (!subs.some((s) => "endpoint" in s && s.endpoint === sub.endpoint)) {
    if (subs.length >= MAX_SUBS) return false;
    subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }); saveJson(SUBS, subs);
  }
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
export async function pushNotify(
  title: string,
  body: string,
  url = "/",
  options: { priority?: "default" | "high" | "critical"; category?: string; badge?: number } = {}
): Promise<void> {
  if (!subs.length) return;
  const safeBody = collapseHomes(scrub((body || "").replace(/[#*`>]/g, ""))).slice(0, 220);
  const payload = JSON.stringify({ title, body: safeBody, url, category: options.category });
  const dead: string[] = [];

  await Promise.all(subs.map(async (s) => {
    if ("expoPushToken" in s) {
      try {
        const res = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: s.expoPushToken,
            title,
            body: safeBody,
            sound: options.priority === "critical" ? "default" : "default",
            priority: options.priority === "critical" ? "high" : "default",
            badge: options.badge,
            data: { url, category: options.category },
          }),
        });
        const d = await res.json();
        if (d?.data?.status === "error" && d?.data?.details?.error === "DeviceNotRegistered") {
          dead.push(s.expoPushToken);
        }
      } catch { /* ignore network errors */ }
    } else {
      try { await webpush.sendNotification(s as any, payload); }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint); }
    }
  }));

  if (dead.length) { 
    subs = subs.filter((s) => !("expoPushToken" in s && dead.includes(s.expoPushToken)) && !("endpoint" in s && dead.includes(s.endpoint))); 
    saveJson(SUBS, subs); 
  }
}
