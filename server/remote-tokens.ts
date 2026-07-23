// ─────────────────────────────────────────────────────────────
//  S.A.M. · SCOPED REMOTE TOKENS  (v1.5 Phase 1)
//
//  Replaces the single owner-token with per-device SCOPED tokens for phone /
//  remote access. Each token carries a scope, a label, and an optional expiry;
//  they're creatable + revocable in Settings. The plaintext token is shown
//  ONCE at creation; only a SHA-256 hash is stored.
//
//  Scopes (least → most privilege):
//   • read-only     — GET/view only; can't run tasks or mutate anything.
//   • no-dangerous  — can run tasks, but dangerous tools are never exposed
//                     (the iOS companion defaults to this).
//   • full          — everything the owner can do remotely.
//
//  The legacy SAM_REMOTE_TOKEN still works and is treated as a `full` token,
//  so existing phone links keep working through the migration.
// ─────────────────────────────────────────────────────────────

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { seal, open } from "./vault-crypto.ts";   // encrypted at rest when vault encryption is on
import { writeFileAtomic } from "./atomic.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const FILE = join(VAULT_DIR, "remote_tokens.json");

export type Scope = "read-only" | "no-dangerous" | "full";
export const SCOPES: Scope[] = ["read-only", "no-dangerous", "full"];

interface StoredToken { id: string; hash: string; label: string; scope: Scope; createdAt: number; expiresAt?: number; lastUsedAt?: number }

function sha(s: string): string { return createHash("sha256").update(s).digest("hex"); }

let cache: StoredToken[] | null = null;
function load(): StoredToken[] {
  if (cache) return cache;
  // open() transparently decrypts when vault encryption is on+unlocked; a LOCKED vault fails closed
  // (no tokens ⇒ no remote access until unlocked — the safe default), and plaintext passes through.
  try {
    const loaded = existsSync(FILE) ? JSON.parse(open(readFileSync(FILE, "utf8"))) : [];
    cache = loaded;                 // AUDIT FIX: cache ONLY a successful read
    return cache!;
  } catch {
    // A locked/undecryptable vault is TRANSIENT. Do NOT cache the empty result: caching []
    // (truthy) meant the tokens never reloaded after unlock, and the next save() then wrote
    // that [] over the real file, destroying every stored token. Return empty for THIS call
    // and retry the real read next time.
    return [];
  }
}
// Persist the in-memory list. AUDIT FIX: serialize `cache` directly (was re-reading via
// load(), so a transient empty read could clobber the file), written atomically at 0600 so a
// crash can't truncate it and no other user on the machine can read the token store. THROWS
// on failure — a token the caller was just handed but that never reached disk is a lie, not a
// best-effort nicety.
function save() {
  if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true });
  writeFileAtomic(FILE, seal(JSON.stringify(cache ?? [])), { mode: 0o600 });
}

export interface CreatedToken { id: string; token: string; label: string; scope: Scope; expiresAt?: number }
// Create a token — returns the plaintext ONCE (never stored). 256-bit secret.
export function createToken(label: string, scope: Scope, ttlDays?: number): CreatedToken {
  const token = randomBytes(32).toString("base64url");
  const id = randomBytes(6).toString("hex");
  const expiresAt = ttlDays && ttlDays > 0 ? Date.now() + ttlDays * 86_400_000 : undefined;
  load().push({ id, hash: sha(token), label: String(label || "device").slice(0, 60), scope: SCOPES.includes(scope) ? scope : "no-dangerous", createdAt: Date.now(), expiresAt });
  save();
  return { id, token, label, scope, expiresAt };
}

// Verify a presented token (constant-time over the candidate set) → its scope, or null.
// Prunes/ignores expired tokens. Touches lastUsedAt on success.
export function verifyToken(token: string): { id: string; scope: Scope; label: string } | null {
  if (!token) return null;
  const h = sha(token);
  const hb = Buffer.from(h);
  const now = Date.now();
  let hit: StoredToken | null = null;
  for (const t of load()) {
    if (t.expiresAt && t.expiresAt < now) continue;
    try { if (t.hash.length === h.length && timingSafeEqual(Buffer.from(t.hash), hb)) hit = t; } catch { /* skip */ }
  }
  if (!hit) return null;
  // Touching lastUsedAt is a nicety; a failed write must never fail a genuinely valid token.
  hit.lastUsedAt = now;
  try { save(); } catch { /* best-effort touch — the token is still valid */ }
  return { id: hit.id, scope: hit.scope, label: hit.label };
}

export function revokeToken(id: string): boolean {
  const before = load().length;
  cache = load().filter((t) => t.id !== id);
  save();
  return cache.length < before;
}

// Sanitised list for Settings — never exposes the hash or plaintext.
export function listTokens(): { id: string; label: string; scope: Scope; createdAt: number; expiresAt?: number; lastUsedAt?: number; expired: boolean }[] {
  const now = Date.now();
  return load().map((t) => ({ id: t.id, label: t.label, scope: t.scope, createdAt: t.createdAt, expiresAt: t.expiresAt, lastUsedAt: t.lastUsedAt, expired: !!(t.expiresAt && t.expiresAt < now) }));
}

// Privilege helpers for the request gate.
export function scopeCanMutate(scope: Scope): boolean { return scope !== "read-only"; }
export function scopeAllowsDangerous(scope: Scope): boolean { return scope === "full"; }
