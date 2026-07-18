// ─────────────────────────────────────────────────────────────
//  S.A.M. · PROVIDER REGISTRY — the single source of provider identity.
//
//  Provider identity used to live in FIVE places: models.ts (runtime lanes), keys.ts (key
//  pools), index.ts (PROVIDER_ENV — what the admin API can save), src/Admin.tsx (what Settings
//  offered) and .env.example (what a human could discover). Nothing kept them in step, and on
//  2026-07-18 the drift produced every provider bug in one day:
//    · 19 providers wired but missing from .env.example — invisible to anyone setting up
//    · `hermes` offered in Settings but absent from PROVIDER_ENV — saving a key returned 400
//    · baidu / tencent / volcengine wired, pooled and saveable, but absent from the UI
//    · `leonardo` posted to the key endpoint when it is a single config value
//
//  Now: pools, PROVIDER_ENV and the Settings list all DERIVE from this array. Add a provider
//  here and it is pooled, saveable and visible at once — there is no second list to forget.
//
//  What deliberately stays elsewhere: the run() closures and lane preferences in models.ts.
//  Those are BEHAVIOUR (how to call a provider, when to prefer it); this file is IDENTITY (what
//  it is called, which env var holds its key, how it appears in Settings). Mixing them is what
//  made the old arrangement drift. `providers.drift.test.ts` enforces that the two agree.
//
//  src/ never imports from server/ — the UI gets this list over /api/admin/config, so the
//  boundary stays clean and there is still only one list.
// ─────────────────────────────────────────────────────────────

export interface ProviderSpec {
  id: string;
  label: string;              // human name, shown in Settings
  tier: "free" | "premium";
  envPlural?: string;         // e.g. GROQ_API_KEYS — the rotating pool
  envSingular?: string;       // e.g. GROQ_API_KEY  — a single key also works
  configKey?: string;         // set instead of envPlural when it is a single CONFIG value
                              // (saved via /api/admin/config, not the rotating key pools)
  starter?: boolean;          // shown first: generous, easy, 2 minutes
  premium?: boolean;          // paid
  noKey?: boolean;            // works with no key at all
  note: string;               // one-line "what it is good at", shown under the label
  url: string;                // where to get a key
  keyPattern?: string;        // regex source: lets the setup wizard recognise a pasted/copied key.
                              // Lives here so the wizard stops keeping its own provider list —
                              // it was the sixth copy, and the only one with these patterns.
}

export const PROVIDER_REGISTRY: ProviderSpec[] = [
  { id: "groq", label: "Groq", tier: "free", envPlural: "GROQ_API_KEYS", envSingular: "GROQ_API_KEY", starter: true, note: "⚡ fast chat — SAM's go-to for quick replies", url: "https://console.groq.com/keys", keyPattern: "^gsk_[A-Za-z0-9]{20,}$" },
  { id: "cerebras", label: "Cerebras", tier: "free", envPlural: "CEREBRAS_API_KEYS", envSingular: "CEREBRAS_API_KEY", starter: true, note: "⚡ fast chat — blazing 70B, first pick", url: "https://cloud.cerebras.ai" },
  { id: "gemini", label: "Google Gemini", tier: "free", envPlural: "GEMINI_API_KEYS", envSingular: "GEMINI_API_KEY", starter: true, note: "👁 photos & vision — reads images; solid all-rounder", url: "https://aistudio.google.com/apikey", keyPattern: "^AIza[A-Za-z0-9_-]{30,}$" },
  { id: "openrouter", label: "OpenRouter", tier: "free", envPlural: "OPENROUTER_API_KEYS", envSingular: "OPENROUTER_API_KEY", starter: true, note: "🌐 many models behind one key — great backup", url: "https://openrouter.ai/keys", keyPattern: "^sk-or-[A-Za-z0-9-]{20,}$" },
  { id: "nvidia", label: "NVIDIA", tier: "free", envPlural: "NVIDIA_API_KEYS", envSingular: "NVIDIA_API_KEY", starter: true, note: "🧠 reasoning — capable 70B for harder questions", url: "https://build.nvidia.com" },
  { id: "mistral", label: "Mistral", tier: "free", envPlural: "MISTRAL_API_KEYS", envSingular: "MISTRAL_API_KEY", starter: true, note: "✍️ writing & chat — solid European models", url: "https://console.mistral.ai/api-keys", keyPattern: "^[A-Za-z0-9]{32}$" },
  { id: "github", label: "GitHub Models", tier: "free", envPlural: "GITHUB_API_KEYS", envSingular: "GITHUB_TOKEN", starter: true, note: "💬 general chat — free with a GitHub token", url: "https://github.com/settings/tokens" },
  { id: "together", label: "Together AI", tier: "free", envPlural: "TOGETHER_API_KEYS", envSingular: "TOGETHER_API_KEY", note: "🧠 reasoning + 🎨 FREE images (FLUX)", url: "https://api.together.xyz/settings/api-keys" },
  { id: "deepseek", label: "DeepSeek", tier: "free", envPlural: "DEEPSEEK_API_KEYS", envSingular: "DEEPSEEK_API_KEY", note: "🧠 deep reasoning + 💻 code — the heavy thinker", url: "https://platform.deepseek.com/api_keys" },
  { id: "sambanova", label: "SambaNova", tier: "free", envPlural: "SAMBANOVA_API_KEYS", envSingular: "SAMBANOVA_API_KEY", note: "⚡ fast chat — very quick 70B", url: "https://cloud.sambanova.ai" },
  { id: "fireworks", label: "Fireworks", tier: "free", envPlural: "FIREWORKS_API_KEYS", envSingular: "FIREWORKS_API_KEY", note: "💻 code + fast models", url: "https://fireworks.ai/account/api-keys" },
  { id: "cohere", label: "Cohere", tier: "free", envPlural: "COHERE_API_KEYS", envSingular: "COHERE_API_KEY", note: "✍️ writing & search-style answers", url: "https://dashboard.cohere.com/api-keys" },
  { id: "hyperbolic", label: "Hyperbolic", tier: "free", envPlural: "HYPERBOLIC_API_KEYS", envSingular: "HYPERBOLIC_API_KEY", note: "💬 general chat — open models", url: "https://app.hyperbolic.xyz/settings" },
  { id: "novita", label: "Novita", tier: "free", envPlural: "NOVITA_API_KEYS", envSingular: "NOVITA_API_KEY", note: "🎬 VIDEO generation + chat (free credits)", url: "https://novita.ai/settings/key-management" },
  { id: "nebius", label: "Nebius", tier: "free", envPlural: "NEBIUS_API_KEYS", envSingular: "NEBIUS_API_KEY", note: "💬 general chat — open models", url: "https://studio.nebius.com" },
  { id: "xai", label: "xAI (Grok)", tier: "free", envPlural: "XAI_API_KEYS", envSingular: "XAI_API_KEY", note: "💬 general chat (Grok)", url: "https://console.x.ai" },
  { id: "huggingface", label: "HuggingFace", tier: "free", envPlural: "HUGGINGFACE_API_KEYS", envSingular: "HUGGINGFACE_API_KEY", note: "🌐 many open models, one token", url: "https://huggingface.co/settings/tokens" },
  { id: "ai21", label: "AI21", tier: "free", envPlural: "AI21_API_KEYS", envSingular: "AI21_API_KEY", note: "✍️ writing (Jamba)", url: "https://studio.ai21.com/account/api-key" },
  { id: "upstage", label: "Upstage", tier: "free", envPlural: "UPSTAGE_API_KEYS", envSingular: "UPSTAGE_API_KEY", note: "💬 light quick chat (Solar)", url: "https://console.upstage.ai/api-keys" },
  { id: "perplexity", label: "Perplexity", tier: "free", envPlural: "PERPLEXITY_API_KEYS", envSingular: "PERPLEXITY_API_KEY", note: "🔍 web-aware answers", url: "https://www.perplexity.ai/settings/api" },
  { id: "siliconflow", label: "SiliconFlow", tier: "free", envPlural: "SILICONFLOW_API_KEYS", envSingular: "SILICONFLOW_API_KEY", note: "🎨 images + 🎬 video + chat (free tier)", url: "https://cloud.siliconflow.cn/account/ak" },
  { id: "alibaba", label: "Qwen (Alibaba)", tier: "free", envPlural: "ALIBABA_API_KEYS", envSingular: "ALIBABA_API_KEY", note: "🧠 reasoning (Qwen) — strong thinker", url: "https://bailian.console.alibabacloud.com" },
  { id: "moonshot", label: "Moonshot (Kimi)", tier: "free", envPlural: "MOONSHOT_API_KEYS", envSingular: "MOONSHOT_API_KEY", note: "📚 long documents (Kimi) — huge context", url: "https://platform.moonshot.ai/console/api-keys" },
  { id: "zhipu", label: "Zhipu GLM-5.2", tier: "free", envPlural: "ZHIPU_API_KEYS", envSingular: "ZHIPU_API_KEY", note: "🧠💻 NEW flagship — 1M context, top coder (20M free tokens)", url: "https://open.bigmodel.cn" },
  { id: "hermes", label: "Hermes (Nous)", tier: "free", envPlural: "HERMES_API_KEYS", envSingular: "HERMES_API_KEY", noKey: true, note: "🪽 open, un-nerfed — elite agentic tool-use & reasoning", url: "https://portal.nousresearch.com" },
  { id: "minimax", label: "MiniMax", tier: "free", envPlural: "MINIMAX_API_KEYS", envSingular: "MINIMAX_API_KEY", note: "💬 general chat", url: "https://platform.minimaxi.com" },
  { id: "volcengine", label: "Doubao (Volcengine)", tier: "free", envPlural: "VOLCENGINE_API_KEYS", envSingular: "VOLCENGINE_API_KEY", note: "💬 general chat — ByteDance", url: "https://console.volcengine.com/ark" },
  { id: "baidu", label: "ERNIE (Baidu)", tier: "free", envPlural: "BAIDU_API_KEYS", envSingular: "BAIDU_API_KEY", note: "💬 general chat — 128k context", url: "https://console.bce.baidu.com/qianfan" },
  { id: "tencent", label: "Hunyuan (Tencent)", tier: "free", envPlural: "TENCENT_API_KEYS", envSingular: "TENCENT_API_KEY", note: "💬 general chat — free lite tier", url: "https://console.cloud.tencent.com/lkeap" },
  { id: "stepfun", label: "StepFun", tier: "free", envPlural: "STEPFUN_API_KEYS", envSingular: "STEPFUN_API_KEY", note: "💬 general chat", url: "https://platform.stepfun.com" },
  { id: "deepinfra", label: "DeepInfra", tier: "free", envPlural: "DEEPINFRA_API_KEYS", envSingular: "DEEPINFRA_API_KEY", note: "🌐 many open models — good backup", url: "https://deepinfra.com/dash/api_keys" },
  { id: "scaleway", label: "Scaleway", tier: "free", envPlural: "SCALEWAY_API_KEYS", envSingular: "SCALEWAY_API_KEY", note: "💬 general chat — EU-hosted", url: "https://console.scaleway.com" },
  { id: "chutes", label: "Chutes", tier: "free", envPlural: "CHUTES_API_KEYS", envSingular: "CHUTES_API_KEY", note: "🌐 many models — decentralised", url: "https://chutes.ai" },
  { id: "friendli", label: "Friendli", tier: "free", envPlural: "FRIENDLI_API_KEYS", envSingular: "FRIENDLI_API_KEY", note: "💬 general chat — fast serving", url: "https://suite.friendli.ai" },
  { id: "codestral", label: "Codestral (Mistral)", tier: "free", envPlural: "CODESTRAL_API_KEYS", envSingular: "CODESTRAL_API_KEY", note: "💻 CODE specialist (Mistral) — free", url: "https://console.mistral.ai/codestral" },
  { id: "inference", label: "Inference.net", tier: "free", envPlural: "INFERENCE_API_KEYS", envSingular: "INFERENCE_API_KEY", note: "💬 general chat — cheap & quick", url: "https://inference.net" },
  { id: "vercel", label: "Vercel AI Gateway", tier: "free", envPlural: "VERCEL_API_KEYS", envSingular: "VERCEL_API_KEY", note: "🌐 100s of models · $5 free EVERY month", url: "https://vercel.com/ai-gateway" },
  { id: "ovh", label: "OVHcloud AI", tier: "free", envPlural: "OVH_API_KEYS", envSingular: "OVH_API_KEY", note: "💬 general chat — EU-hosted free tier", url: "https://endpoints.ai.cloud.ovh.net" },
  { id: "gmi", label: "GMI Cloud", tier: "free", envPlural: "GMI_API_KEYS", envSingular: "GMI_API_KEY", note: "🧠 DeepSeek/Llama/Qwen hosting", url: "https://console.gmicloud.ai" },
  { id: "leonardo", label: "Leonardo.Ai", tier: "free", envPlural: "LEONARDO_API_KEYS", envSingular: "LEONARDO_API_KEY", note: "🎨 images + img2video — $5 free credit", url: "https://app.leonardo.ai/settings" },
  { id: "fal", label: "fal (HappyHorse)", tier: "free", envPlural: "FAL_API_KEYS", envSingular: "FAL_KEY", note: "🎬 #1 VIDEO model — HappyHorse w/ native audio (free credits)", url: "https://fal.ai/dashboard/keys" },
  { id: "anthropic", label: "Anthropic (Claude)", tier: "premium", envPlural: "ANTHROPIC_API_KEYS", envSingular: "ANTHROPIC_API_KEY", premium: true, note: "👑 premium (paid) — best quality, only on 'Best'", url: "https://console.anthropic.com/settings/keys" },
  { id: "openai", label: "OpenAI", tier: "premium", envPlural: "OPENAI_API_KEYS", envSingular: "OPENAI_API_KEY", premium: true, note: "👑 premium (paid) — only on 'Best'", url: "https://platform.openai.com/api-keys" },
];

/** id -> pool env vars, for keys.ts. Only providers with a rotating pool. */
export const POOLED = PROVIDER_REGISTRY.filter((p) => p.envPlural && p.envSingular);

/** id -> env var, for the admin save endpoint. */
export const PROVIDER_ENV: Record<string, string> = Object.fromEntries(
  PROVIDER_REGISTRY.filter((p) => p.envPlural).map((p) => [p.id, p.envPlural!]),
);

/** Providers that save through /api/admin/config instead of the key pools. */
export const CONFIG_STYLE: Record<string, string> = Object.fromEntries(
  PROVIDER_REGISTRY.filter((p) => p.configKey).map((p) => [p.id, p.configKey!]),
);

/** What the Settings UI needs — no env var names leave the server. */
export function uiCatalogue() {
  return PROVIDER_REGISTRY.map(({ id, label, tier, note, url, starter, premium, noKey, configKey, keyPattern }) => ({
    id, label, tier, note, url, starter: !!starter, premium: !!premium, noKey: !!noKey,
    configStyle: !!configKey, keyPattern,
  }));
}
