// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — pairing a browser
//
//  A browser tab can watch the yard but not drive it, because driving it means running
//  commands and the per-launch passkey only reaches the desktop app. The obvious fix —
//  serving the passkey to any page that asks — is not a fix at all: a secret any page
//  can fetch is a secret any local process can fetch, which is the exact thing the
//  Handshake exists to prevent.
//
//  So the browser is PAIRED instead, and the approval comes from something that already
//  holds the passkey:
//
//    1. the browser asks, and is given a short code to display
//    2. the desktop app shows the request, and the person compares the two codes
//    3. the app approves — with the passkey — and only then is a token minted
//    4. the browser collects that token and uses it for writes from then on
//
//  The code is what makes step 2 meaningful. Without it, a hostile local process could
//  raise its own request at the same moment and have it approved by mistake; with it,
//  the person is approving a specific request they can see on their own screen.
//
//  Tokens are per-browser, revocable, and never grant more than the yard's own writes.
// ─────────────────────────────────────────────────────────────

import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { yardDir } from "./store.ts";

// Five minutes, not two. The real journey is: read the code, find the desktop app,
// open the Control Centre, find the row, compare the number, approve. Two minutes was
// measured against a machine doing it instantly and expired on a person doing it
// properly — the request vanished mid-approval with nothing to say why.
const REQUEST_TTL_MS = 5 * 60_000;
const MAX_PENDING = 5;                  // enough for a mistake, not enough to spam an approval
const TOKEN_BYTES = 32;

export interface PairRequest { id: string; code: string; label: string; at: number }
export interface PairedBrowser { id: string; label: string; pairedAt: number; lastSeen: number }

// Stored HASHED. A paired token is a credential, and a credential kept in plain text is
// one file-read away from being everyone's.
interface StoredToken { id: string; label: string; hash: string; pairedAt: number; lastSeen: number }

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function file(): string { return join(yardDir(), "paired.json"); }

function load(): StoredToken[] {
  try { const d = JSON.parse(readFileSync(file(), "utf8")); return Array.isArray(d) ? d : []; }
  catch { return []; }
}
function save(list: StoredToken[]): void {
  const dir = yardDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file(), `${JSON.stringify(list, null, 2)}\n`);
}

// Pending requests live in memory only. A request that does not survive a restart is
// correct: it is a conversation happening right now, not a stored permission.
const pending = new Map<string, PairRequest>();

function sweep(now: number): void {
  for (const [id, r] of pending) if (now - r.at > REQUEST_TTL_MS) pending.delete(id);
}

// Six digits, read aloud or compared at a glance. Generated from real randomness rather
// than a counter so it cannot be predicted and pre-approved.
export function makeCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export function requestPairing(label: string, now = Date.now()): PairRequest | null {
  sweep(now);
  if (pending.size >= MAX_PENDING) return null;   // refuse to drown an approval screen
  const req: PairRequest = {
    id: randomBytes(9).toString("hex"),
    code: makeCode(),
    label: String(label || "a browser").slice(0, 60),
    at: now,
  };
  pending.set(req.id, req);
  return req;
}

// What the desktop app shows. The code is included because the whole point is that the
// person compares it with what the browser is displaying.
export function pendingRequests(now = Date.now()): PairRequest[] {
  sweep(now);
  return [...pending.values()].sort((a, b) => a.at - b.at);
}

export interface Approval { token: string; browser: PairedBrowser }

// Called by something holding the passkey. The code must match the request being
// approved — approving by id alone would let a request the person cannot see be
// confirmed by a click meant for a different one.
export function approvePairing(id: string, code: string, now = Date.now()): Approval | null {
  sweep(now);
  const req = pending.get(String(id));
  if (!req) return null;
  const given = String(code || "");
  if (given.length !== req.code.length) return null;
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(req.code))) return null;

  pending.delete(req.id);
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const browser: PairedBrowser = { id: req.id, label: req.label, pairedAt: now, lastSeen: now };
  const list = load();
  list.push({ id: browser.id, label: browser.label, hash: sha(token), pairedAt: now, lastSeen: now });
  save(list);
  return { token, browser };
}

export function denyPairing(id: string): boolean { return pending.delete(String(id)); }

// The browser asks whether its own request has been approved yet. Answering only for the
// id the browser already holds means this cannot be used to enumerate other requests.
const collected = new Map<string, string>();   // request id → token, collected once
export function stashForCollection(id: string, token: string) { collected.set(id, token); }
export function collect(id: string): string | null {
  const t = collected.get(String(id));
  if (t) collected.delete(String(id));   // one collection only; a token left lying around is a spare key
  return t ?? null;
}

// Is this token one of ours? Compared against stored hashes, so the file never holds
// anything usable on its own.
export function verifyPairToken(token: unknown, now = Date.now()): PairedBrowser | null {
  const t = typeof token === "string" ? token : "";
  if (t.length !== TOKEN_BYTES * 2) return null;
  const want = sha(t);
  const list = load();
  const hit = list.find((s) => s.hash.length === want.length && timingSafeEqual(Buffer.from(s.hash), Buffer.from(want)));
  if (!hit) return null;
  hit.lastSeen = now;
  save(list);
  return { id: hit.id, label: hit.label, pairedAt: hit.pairedAt, lastSeen: hit.lastSeen };
}

export function pairedBrowsers(): PairedBrowser[] {
  return load().map((s) => ({ id: s.id, label: s.label, pairedAt: s.pairedAt, lastSeen: s.lastSeen }));
}

export function revokePairing(id: string): boolean {
  const list = load();
  const next = list.filter((s) => s.id !== String(id));
  if (next.length === list.length) return false;
  save(next);
  return true;
}

// For tests: forget everything in memory.
export function clearPending() { pending.clear(); collected.clear(); }
