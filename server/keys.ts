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
  // New "Invincible" free/cheap providers
  together: readPool("together", "TOGETHER_API_KEYS", "TOGETHER_API_KEY"),
  sambanova: readPool("sambanova", "SAMBANOVA_API_KEYS", "SAMBANOVA_API_KEY"),
  deepseek: readPool("deepseek", "DEEPSEEK_API_KEYS", "DEEPSEEK_API_KEY"),
  fireworks: readPool("fireworks", "FIREWORKS_API_KEYS", "FIREWORKS_API_KEY"),
  xai: readPool("xai", "XAI_API_KEYS", "XAI_API_KEY"),
  huggingface: readPool("huggingface", "HUGGINGFACE_API_KEYS", "HUGGINGFACE_API_KEY"),
  hyperbolic: readPool("hyperbolic", "HYPERBOLIC_API_KEYS", "HYPERBOLIC_API_KEY"),
  novita: readPool("novita", "NOVITA_API_KEYS", "NOVITA_API_KEY"),
  siliconflow: readPool("siliconflow", "SILICONFLOW_API_KEYS", "SILICONFLOW_API_KEY"),
  ai21: readPool("ai21", "AI21_API_KEYS", "AI21_API_KEY"),
  upstage: readPool("upstage", "UPSTAGE_API_KEYS", "UPSTAGE_API_KEY"),
  nebius: readPool("nebius", "NEBIUS_API_KEYS", "NEBIUS_API_KEY"),
  cohere: readPool("cohere", "COHERE_API_KEYS", "COHERE_API_KEY"),
  perplexity: readPool("perplexity", "PERPLEXITY_API_KEYS", "PERPLEXITY_API_KEY"),
  // ── "Infinite Compute" Global Mesh — Asian Heavyweights ──
  alibaba: readPool("alibaba", "ALIBABA_API_KEYS", "ALIBABA_API_KEY"),
  volcengine: readPool("volcengine", "VOLCENGINE_API_KEYS", "VOLCENGINE_API_KEY"),
  zhipu: readPool("zhipu", "ZHIPU_API_KEYS", "ZHIPU_API_KEY"),
  hermes: readPool("hermes", "HERMES_API_KEYS", "HERMES_API_KEY"),
  leonardo: readPool("leonardo", "LEONARDO_API_KEYS", "LEONARDO_API_KEY"),
  moonshot: readPool("moonshot", "MOONSHOT_API_KEYS", "MOONSHOT_API_KEY"),
  minimax: readPool("minimax", "MINIMAX_API_KEYS", "MINIMAX_API_KEY"),
  stepfun: readPool("stepfun", "STEPFUN_API_KEYS", "STEPFUN_API_KEY"),
  baidu: readPool("baidu", "BAIDU_API_KEYS", "BAIDU_API_KEY"),
  tencent: readPool("tencent", "TENCENT_API_KEYS", "TENCENT_API_KEY"),
  // ── Bonus free/free-credit providers ──
  deepinfra: readPool("deepinfra", "DEEPINFRA_API_KEYS", "DEEPINFRA_API_KEY"),
  scaleway: readPool("scaleway", "SCALEWAY_API_KEYS", "SCALEWAY_API_KEY"),
  chutes: readPool("chutes", "CHUTES_API_KEYS", "CHUTES_API_KEY"),
  friendli: readPool("friendli", "FRIENDLI_API_KEYS", "FRIENDLI_API_KEY"),
  codestral: readPool("codestral", "CODESTRAL_API_KEYS", "CODESTRAL_API_KEY"),
  inference: readPool("inference", "INFERENCE_API_KEYS", "INFERENCE_API_KEY"),
  gmi: readPool("gmi", "GMI_API_KEYS", "GMI_API_KEY"),
  vercel: readPool("vercel", "VERCEL_API_KEYS", "VERCEL_API_KEY"),
  ovh: readPool("ovh", "OVH_API_KEYS", "OVH_API_KEY"),
  fal: readPool("fal", "FAL_API_KEYS", "FAL_KEY"),
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
