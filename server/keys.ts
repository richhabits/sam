// SAM · KEY VAULT (rotation + pooling)
import { POOLED } from "./providers.registry.ts";
import * as safe from "./safe.ts";

// Point of use: read a secret from the SAFE first (when it's set up + UNLOCKED), else process.env.
// Guarded so it never throws — a locked Safe returns undefined here and we fall back, so pool-building
// at import time (before the Safe unlocks) is safe. After the Safe unlocks, reloadPools() re-reads and
// the pools pick up the sealed keys — WITHOUT the plaintext ever needing to sit in process.env.
function secretVal(name: string): string | undefined {
  if (safe.isSetup() && safe.isUnlocked()) { const v = safe.get(name); if (v !== undefined && v !== "") return v; }
  return process.env[name] || undefined;
}

interface KeyState { key: string; uses: number; failures: number; cooldownUntil: number; }

class KeyPool {
  provider: string;
  keys: KeyState[] = [];
  private idx = 0;
  constructor(provider: string, raw: string[]) {
    const seen = new Set<string>();
    for (const k of raw) {
      const key = k.trim();
      if (key && !seen.has(key)) { seen.add(key); this.keys.push({ key, uses: 0, failures: 0, cooldownUntil: 0 }); }
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
      if (k.cooldownUntil <= now) { k.uses++; return k.key; }
    }
    return null;
  }
  reportSuccess(key: string) { const k = this.keys.find((x) => x.key === key); if (k) { k.failures = 0; k.cooldownUntil = 0; } }
  reportFailure(key: string, status?: number) {
    const k = this.keys.find((x) => x.key === key);
    if (!k) return;
    k.failures++;
    if (status === 429) k.cooldownUntil = Date.now() + 60000;
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
export function reportFailure(provider: string, key: string, status?: number) { POOLS[provider]?.reportFailure(key, status); }
export function poolSize(provider: string): number { return POOLS[provider]?.size ?? 0; }
export function keyStatus() { return Object.values(POOLS).map((p) => p.status()); }

const summary = Object.entries(POOLS).filter(([, p]) => p.size > 0).map(([name, p]) => `${name}×${p.size}`).join(", ");
// Skip the boot banner for `--version`/`version` so the CLI prints only the version (issue #13).
if (!process.argv.slice(2).some((a) => a === "--version" || a === "version")) {
  console.log(`  keys pooled     · ${summary || "none yet (add *_API_KEYS to .env)"}`);
}
