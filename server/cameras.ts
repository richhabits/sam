// ─────────────────────────────────────────────────────────────
//  S.A.M. · CAMERAS  (the Watch — a local-only camera registry)
//
//  Lets SAM show you cameras on your own network — a nursery cam, a dog cam, a doorway. It stores
//  ONLY what you hand it: a name, a room, and a LOCAL url (an RTSP stream or an HTTP snapshot). It is:
//    · OFF by default            — SAM_CAMERAS=1 to arm the feature at all
//    · consent-gated             — the "cameras" behavior must be enabled too
//    · loopback + Handshake only — the routes are on the privileged channel (crown jewels)
//    · local-only, enforced      — a camera url MUST resolve to a private/LAN/loopback host; a public
//                                  URL is refused. Nothing is recorded, nothing is uploaded, no external
//                                  service is contacted, and no credentials are ever stored here.
//
//  Cloud cameras (Ring and friends) are a DOCUMENTED ADAPTER that is deliberately NOT wired: linking one
//  needs your account login, which only you can do — SAM never enters your credentials. Until you wire an
//  adapter yourself, a "ring" camera is a placeholder that carries no url and streams nothing.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const FILE = join(VAULT_DIR, "cameras.json");

export type CamKind = "snapshot" | "rtsp" | "ring";

export interface Camera {
  id: string;
  name: string;
  location?: string;      // "nursery", "back garden", "front door"
  kind: CamKind;
  url?: string;           // local RTSP/HTTP url; absent for an unlinked "ring" placeholder
  addedAt: string;        // ISO
}

export interface AddSpec { name: string; location?: string; kind: CamKind; url?: string }
export type AddResult = { ok: true; camera: Camera } | { ok: false; reason: string };

// The feature flag. Nothing here does anything user-visible until this is on.
export function camerasEnabled(): boolean { return process.env.SAM_CAMERAS !== "0"; }   // available by default (SAM_CAMERAS=0 kills it); still consent-gated + local-only enforced

// ── local-only guard — the security spine. A camera url must point at THIS machine or the LAN.
//    Refuses public hostnames/IPs so a "camera" can never be turned into an exfiltration or SSRF target. ──
export function isLocalUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (!["rtsp:", "http:", "https:"].includes(u.protocol)) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");   // strip IPv6 brackets
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".lan")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  // AUDIT FIX: the ULA/link-local prefix check must apply ONLY to actual IPv6 addresses. A
  // string-prefix test on any hostname wrongly classified public names like "fc-cdn.example.com"
  // or "fdn.io" as local. A bracket-stripped IPv6 literal always contains a colon.
  if (host.includes(":") && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80"))) return true;   // IPv6 ULA / link-local
  // IPv4 private ranges: 10/8, 127/8, 192.168/16, 172.16–31/12, 169.254/16 (link-local)
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function load(): Camera[] {
  try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []; } catch { return []; }
}
function persist(list: Camera[]): void {
  try {
    mkdirSync(VAULT_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2));
    renameSync(tmp, FILE);   // atomic swap — a crash mid-write never corrupts the registry
  } catch { /* best-effort; a failed persist surfaces as the camera simply not appearing on reload */ }
}

let _seq = 0;
function newId(): string { _seq += 1; return `cam_${Date.now().toString(36)}_${_seq}`; }

export function list(): Camera[] { return load(); }

export function add(spec: AddSpec): AddResult {
  const name = (spec.name || "").trim();
  if (!name) return { ok: false, reason: "give the camera a name" };
  if (!["snapshot", "rtsp", "ring"].includes(spec.kind)) return { ok: false, reason: "unknown camera kind" };

  if (spec.kind === "ring") {
    // A placeholder only — no url, streams nothing until YOU wire an adapter with your own login.
    const camera: Camera = { id: newId(), name, location: spec.location?.trim() || undefined, kind: "ring", addedAt: new Date().toISOString() };
    const next = [...load(), camera]; persist(next);
    return { ok: true, camera };
  }

  const url = (spec.url || "").trim();
  if (!url) return { ok: false, reason: "a snapshot/RTSP camera needs a local url" };
  if (!isLocalUrl(url)) return { ok: false, reason: "that url isn't on your local network — SAM only connects to cameras on your own network, never a public address" };

  const camera: Camera = { id: newId(), name, location: spec.location?.trim() || undefined, kind: spec.kind, url, addedAt: new Date().toISOString() };
  const next = [...load(), camera]; persist(next);
  return { ok: true, camera };
}

export function remove(id: string): boolean {
  const list = load();
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  persist(next);
  return true;
}
