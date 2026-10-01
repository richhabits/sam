// SAM · KEY VAULT (rotation + pooling)
import { POOLED } from "./providers.registry.ts";
import * as safe from "./safe.ts";
import { dayHeadroom, nearQuota, quotaFreesAt, slotId } from "./usage-ledger.ts";

// Point of use: read a secret from the SAFE first (when it's set up + UNLOCKED), else process.env.
// Guarded so it never throws — a locked Safe returns undefined here and we fall back, so pool-building
// at import time (before the Safe unlocks) is safe. After the Safe unlocks, reloadPools() re-reads and
// the pools pick up the sealed keys — WITHOUT the plaintext ever needing to sit in process.env.
function secretVal(name: string): string | undefined {
  // Once the Safe HOLDS this name — even cleared to "" — it is authoritative and must not fall
  // through to process.env: a key cleared via Settings writes "" here (removeEnvKeys() only
  // scrubs the .env FILE, never the running process's env), and falling back on empty used to
  // let that stale in-memory value silently revive a key the user just deleted.
  if (safe.isSetup() && safe.isUnlocked() && safe.has(name)) return safe.get(name) || undefined;
  return process.env[name] || undefined;
}

// Secrets that are NOT model keys — a Slack bot token, a Vercel token — need the same
// Safe-first-then-env order, and there is no reason for each caller to re-derive it (the yard's
// deploy token already re-derived it once, and a third copy is how the order drifts).
export function readSecret(name: string): string | null { return secretVal(name) ?? null; }

// `slot` is the ledger's opaque id for this key (usage-ledger.ts) — computed once, never the key.
interface KeyState { key: string; slot: string; uses: number; failures: number; cooldownUntil: number; }

// A 429's Retry-After is honoured exactly, but never trusted to bench a key for longer than a day.
const MAX_RETRY_AFTER_MS = 24 * 3600 * 1000;

class KeyPool {
  provider: string;
  keys: KeyState[] = [];
  private idx = 0;
  constructor(provider: string, raw: string[]) {
    const seen = new Set<string>();
    for (const k of raw) {
      const key = k.trim();
      if (key && !seen.has(key)) { seen.add(key); this.keys.push({ key, slot: slotId(key), uses: 0, failures: 0, cooldownUntil: 0 }); }
    }
    this.provider = provider;
  }
  get size() { return this.keys.length; }
  next(): string | null {
    if (this.keys.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[this.idx % this.keys.length];
      this.idx++;
      // Skip a slot that is cooling OR has used ≥90% of a documented free window (free-quotas.ts):
      // stepping aside before the provider says 429 keeps every key in good standing.
      if (k.cooldownUntil <= now && !nearQuota(this.provider, k.slot, now)) { k.uses++; return k.key; }
    }
    return null;
  }
  /** First usable key WITHOUT counting a use or advancing the rotation — for list-only calls
   *  (model discovery) that must not skew the round-robin or the usage numbers. */
  peek(): string | null {
    const now = Date.now();
    return this.keys.find((k) => k.cooldownUntil <= now)?.key ?? null;
  }
  /** Can this lane be tried right now, when does it free up, and how much daily budget is left on
   *  its best usable key? Deliberately no key COUNT — callers that publish this must not leak it. */
  availability(now = Date.now()): { usable: boolean; coolingUntil: number; headroom: number } {
    let usable = false, headroom = 0, soonest = 0;
    for (const k of this.keys) {
      const gatedUntil = quotaFreesAt(this.provider, k.slot, now);
      const until = Math.max(k.cooldownUntil > now ? k.cooldownUntil : 0, gatedUntil);
      if (until === 0) { usable = true; headroom = Math.max(headroom, dayHeadroom(this.provider, k.slot, now)); }
      else if (!soonest || until < soonest) soonest = until;
    }
    return { usable, coolingUntil: usable ? 0 : soonest, headroom: usable ? headroom : 0 };
  }
  reportSuccess(key: string) { const k = this.keys.find((x) => x.key === key); if (k) { k.failures = 0; k.cooldownUntil = 0; } }
  reportFailure(key: string, status?: number, retryAfterMs?: number) {
    const k = this.keys.find((x) => x.key === key);
    if (!k) return;
    k.failures++;
    // 429: the provider told us exactly when (Retry-After / x-ratelimit-reset-*, parsed in
    // model-providers.ts). Use it to the millisecond; the flat minute is only the fallback.
    if (status === 429) k.cooldownUntil = Date.now() + (retryAfterMs && retryAfterMs > 0 ? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS) : 60000);
    else if (status === 401 || status === 403) k.cooldownUntil = Date.now() + 3600000;
    else k.cooldownUntil = Date.now() + 15000;
  }
  status() {
    const now = Date.now();
    const coolingKeys = this.keys.filter((k) => k.cooldownUntil > now);
    return { provider: this.provider, total: this.keys.length,
      healthy: this.keys.filter((k) => k.cooldownUntil <= now).length,
      cooling: coolingKeys.length,
      uses: this.keys.reduce((a, k) => a + k.uses, 0),
      // soonest a cooling key frees up (ms epoch, 0 if none cooling) — for the usage page countdown
      coolingUntil: coolingKeys.length ? Math.min(...coolingKeys.map((k) => k.cooldownUntil)) : 0 };
  }
}

function readPool(provider: string, plural: string, singular: string): KeyPool {
  const raw: string[] = [];
  const p = secretVal(plural); if (p) raw.push(...p.split(","));
  const s = secretVal(singular); if (s) raw.push(s);
  return new KeyPool(provider, raw);
}

const POOLS: Record<string, KeyPool> = {
  // Derived from PROVIDER_REGISTRY — the single source of provider identity. This was a
  // hand-maintained list that drifted from the UI / PROVIDER_ENV / .env.example (see the
  // registry header for the four bugs that caused). Adding a provider there pools it here.
  ...Object.fromEntries(POOLED.map((p) => [p.id, readPool(p.id, p.envPlural!, p.envSingular!)])),
};

// Rebuild every provider pool from the current sources — called AFTER the Safe unlocks at boot, so
// pools sealed in the Safe (and stripped from .env) are picked up. Without this, pools built at import
// time (before unlock) would be empty after a migration. Returns the total keys pooled.
export function reloadPools(): number {
  let total = 0;
  for (const p of POOLED) { const pool = readPool(p.id, p.envPlural!, p.envSingular!); POOLS[p.id] = pool; total += pool.size; }
  return total;
}

// Replace a provider's pool at runtime (used by the in-app Admin panel).
export function setPool(provider: string, rawKeys: string[]) {
  POOLS[provider] = new KeyPool(provider, rawKeys);
  return POOLS[provider].size;
}

export function getKey(provider: string): string | null { return POOLS[provider]?.next() ?? null; }
export function reportSuccess(provider: string, key: string) { POOLS[provider]?.reportSuccess(key); }
export function reportFailure(provider: string, key: string, status?: number, retryAfterMs?: number) { POOLS[provider]?.reportFailure(key, status, retryAfterMs); }
export function peekKey(provider: string): string | null { return POOLS[provider]?.peek() ?? null; }
export function laneAvailability(provider: string, now = Date.now()) { return POOLS[provider]?.availability(now) ?? { usable: false, coolingUntil: 0, headroom: 0 }; }
export function poolSize(provider: string): number { return POOLS[provider]?.size ?? 0; }
export function keyStatus() { return Object.values(POOLS).map((p) => p.status()); }

const summary = Object.entries(POOLS).filter(([, p]) => p.size > 0).map(([name, p]) => `${name}×${p.size}`).join(", ");
// Skip the boot banner for `--version`/`version` so the CLI prints only the version (issue #13).
if (!process.argv.slice(2).some((a) => a === "--version" || a === "version")) {
  console.log(`  keys pooled     · ${summary || "none yet (add *_API_KEYS to .env)"}`);
}
