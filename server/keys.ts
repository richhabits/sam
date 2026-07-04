// SAM · KEY VAULT (rotation + pooling)
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
    return { provider: this.provider, total: this.keys.length,
      healthy: this.keys.filter((k) => k.cooldownUntil <= now).length,
      cooling: this.keys.filter((k) => k.cooldownUntil > now).length,
      uses: this.keys.reduce((a, k) => a + k.uses, 0) };
  }
}

function readPool(provider: string, plural: string, singular: string): KeyPool {
  const raw: string[] = [];
  if (process.env[plural]) raw.push(...process.env[plural]!.split(","));
  if (process.env[singular]) raw.push(process.env[singular]!);
  return new KeyPool(provider, raw);
}

const POOLS: Record<string, KeyPool> = {
  nvidia: readPool("nvidia", "NVIDIA_API_KEYS", "NVIDIA_API_KEY"),
  cerebras: readPool("cerebras", "CEREBRAS_API_KEYS", "CEREBRAS_API_KEY"),
  mistral: readPool("mistral", "MISTRAL_API_KEYS", "MISTRAL_API_KEY"),
  github: readPool("github", "GITHUB_API_KEYS", "GITHUB_TOKEN"),
  gemini: readPool("gemini", "GEMINI_API_KEYS", "GEMINI_API_KEY"),
  groq: readPool("groq", "GROQ_API_KEYS", "GROQ_API_KEY"),
  openrouter: readPool("openrouter", "OPENROUTER_API_KEYS", "OPENROUTER_API_KEY"),
  openai: readPool("openai", "OPENAI_API_KEYS", "OPENAI_API_KEY"),
  anthropic: readPool("anthropic", "ANTHROPIC_API_KEYS", "ANTHROPIC_API_KEY"),
};

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
console.log(`  keys pooled     · ${summary || "none yet (add *_API_KEYS to .env)"}`);
