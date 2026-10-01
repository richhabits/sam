// ─────────────────────────────────────────────────────────────
//  AI DISCLOSURE — which third parties could receive a chat message.
//
//  App Store guideline 5.1.2(i): disclose where personal data is shared with third parties,
//  including third-party AI, and get explicit permission first. The native apps send chats to the
//  user's own Mac, which may route them onward; the app needs the NAMES so the consent prompt can
//  be honest. This module answers from the REAL router state, not from a hand-kept list:
//
//    · a keyed provider counts only if PROVIDERS (model-providers.ts) has a lane for it AND its
//      KeyPool (keys.ts) holds at least one key — exactly the filter runModelInner applies
//      (models.ts: `poolSize(p.id) > 0 || p.noKey`).
//    · a keyless lane counts only if the router falls back to it with no key (`noKey`), which
//      today means the Pollinations lanes. Hermes is also flagged noKey, but with no Nous key and no
//      OpenRouter key its own fallback is local Ollama, so it is NOT keyless-cloud; it appears as a
//      cloud provider only when a Nous key is pooled (its OpenRouter path is reported as OpenRouter).
//    · the optional SAM Cloud gateway (SAM_GATEWAY_URL) is listed as keyless when configured.
//
//  Never emitted: key values, key counts, env var values. Only ids and the static public facts below.
// ─────────────────────────────────────────────────────────────
import { poolSize as realPoolSize } from "./keys.ts";
import { GATEWAY_URL, PROVIDERS, type Provider } from "./model-providers.ts";
import { PROVIDER_REGISTRY } from "./providers.registry.ts";

export interface AiParty { id: string; name: string; company: string; privacy: string; free: boolean }
export interface AiProvidersReport { onDevice: boolean; cloud: AiParty[]; keyless: AiParty[]; updated: string }

// id -> [display name, company, privacy policy URL]. Official URLs only where known; where the exact
// policy path was not verified, the provider's main site is used (listed in the PR description).
const INFO: Record<string, [string, string, string]> = {
  groq: ["Groq", "Groq, Inc.", "https://groq.com/privacy-policy/"],
  cerebras: ["Cerebras", "Cerebras Systems Inc.", "https://www.cerebras.ai/privacy-policy"],
  sambanova: ["SambaNova", "SambaNova Systems, Inc.", "https://sambanova.ai/privacy-policy"],
  gemini: ["Google Gemini", "Google LLC", "https://policies.google.com/privacy"],
  mistral: ["Mistral", "Mistral AI", "https://mistral.ai/terms/#privacy-policy"],
  codestral: ["Codestral (Mistral)", "Mistral AI", "https://mistral.ai/terms/#privacy-policy"],
  openrouter: ["OpenRouter", "OpenRouter, Inc.", "https://openrouter.ai/privacy"],
  nvidia: ["NVIDIA", "NVIDIA Corporation", "https://www.nvidia.com/en-us/about-nvidia/privacy-policy/"],
  anthropic: ["Anthropic (Claude)", "Anthropic, PBC", "https://www.anthropic.com/legal/privacy"],
  openai: ["OpenAI", "OpenAI, L.L.C.", "https://openai.com/policies/privacy-policy"],
  github: ["GitHub Models", "GitHub, Inc. (Microsoft)", "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"],
  together: ["Together AI", "Together Computer, Inc.", "https://www.together.ai/privacy"],
  deepseek: ["DeepSeek", "Hangzhou DeepSeek Artificial Intelligence Co., Ltd.", "https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html"],
  fireworks: ["Fireworks AI", "Fireworks AI, Inc.", "https://fireworks.ai/privacy-policy"],
  cohere: ["Cohere", "Cohere Inc.", "https://cohere.com/privacy"],
  hyperbolic: ["Hyperbolic", "Hyperbolic Labs, Inc.", "https://hyperbolic.xyz"],
  novita: ["Novita AI", "Novita AI", "https://novita.ai/legal/privacy-policy"],
  nebius: ["Nebius", "Nebius B.V.", "https://nebius.com/privacy"],
  xai: ["xAI (Grok)", "X.AI Corp.", "https://x.ai/legal/privacy-policy"],
  huggingface: ["Hugging Face", "Hugging Face, Inc.", "https://huggingface.co/privacy"],
  ai21: ["AI21 Labs", "AI21 Labs", "https://www.ai21.com/privacy-policy"],
  upstage: ["Upstage", "Upstage AI", "https://www.upstage.ai"],
  perplexity: ["Perplexity", "Perplexity AI, Inc.", "https://www.perplexity.ai/hub/legal/privacy-policy"],
  siliconflow: ["SiliconFlow", "SiliconFlow", "https://siliconflow.com"],
  alibaba: ["Qwen (Alibaba Cloud)", "Alibaba Cloud", "https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-privacy-policy"],
  volcengine: ["Doubao (Volcengine)", "Volcengine (ByteDance)", "https://www.volcengine.com"],
  zhipu: ["Zhipu GLM", "Zhipu AI", "https://open.bigmodel.cn"],
  hermes: ["Hermes (Nous Research)", "Nous Research, Inc.", "https://nousresearch.com"],
  moonshot: ["Moonshot (Kimi)", "Moonshot AI", "https://www.moonshot.ai"],
  minimax: ["MiniMax", "MiniMax", "https://www.minimax.io"],
  stepfun: ["StepFun", "StepFun", "https://www.stepfun.com"],
  baidu: ["ERNIE (Baidu)", "Baidu, Inc.", "https://cloud.baidu.com"],
  tencent: ["Hunyuan (Tencent)", "Tencent Cloud", "https://cloud.tencent.com"],
  deepinfra: ["DeepInfra", "Deep Infra, Inc.", "https://deepinfra.com/privacy"],
  scaleway: ["Scaleway", "Scaleway SAS", "https://www.scaleway.com/en/privacy-policy/"],
  chutes: ["Chutes", "Chutes", "https://chutes.ai"],
  friendli: ["Friendli", "FriendliAI Inc.", "https://friendli.ai/privacy"],
  inference: ["Inference.net", "Inference.net", "https://inference.net"],
  gmi: ["GMI Cloud", "GMI Cloud", "https://www.gmicloud.ai"],
  vercel: ["Vercel AI Gateway", "Vercel Inc.", "https://vercel.com/legal/privacy-policy"],
  ovh: ["OVHcloud AI", "OVH SAS", "https://www.ovhcloud.com/en/personal-data-protection/"],
  pollinations: ["Pollinations", "Pollinations.AI", "https://pollinations.ai"],
  "sam-cloud": ["SAM Cloud gateway", "the operator of this SAM build", "https://github.com/richhabits/sam/blob/main/docs/PRIVACY.md"],
};

const registryOf = (id: string) => PROVIDER_REGISTRY.find((p) => p.id === id);

function party(id: string, free: boolean): AiParty {
  const known = INFO[id];
  if (known) return { id, name: known[0], company: known[1], privacy: known[2], free };
  // Unmapped provider: fall back to the registry label and the provider's own site, never a guess.
  const r = registryOf(id);
  return { id, name: r?.label ?? id, company: r?.label ?? id, privacy: r?.url ?? "", free };
}

export interface DisclosureDeps {
  providers?: Provider[];
  poolSize?: (id: string) => number;
  env?: Record<string, string | undefined>;
  gatewayUrl?: string;
  now?: () => Date;
}

export function aiProvidersReport(deps: DisclosureDeps = {}): AiProvidersReport {
  const providers = deps.providers ?? PROVIDERS;
  const poolSize = deps.poolSize ?? realPoolSize;
  const env = deps.env ?? process.env;
  const gatewayUrl = deps.gatewayUrl ?? GATEWAY_URL;

  const isFree = (p: Provider) => p.tier === "free" && registryOf(p.id)?.tier !== "premium";
  const cloud: AiParty[] = [];
  const keyless: AiParty[] = [];
  const seenKeyless = new Set<string>();
  for (const p of providers) {
    if (p.tier === "local") continue;
    if (poolSize(p.id) > 0) { cloud.push(party(p.id, isFree(p))); continue; }
    // noKey + no key of its own: Hermes falls back to local Ollama, so only true keyless-cloud lanes
    // (id other than "hermes") are disclosed. Pollinations' three lanes collapse to one party.
    if (p.noKey && p.id !== "hermes") {
      const id = p.id.startsWith("pollinations") ? "pollinations" : p.id;
      if (!seenKeyless.has(id)) { seenKeyless.add(id); keyless.push(party(id, true)); }
    }
  }
  // The gateway is only consulted when no cloud key is pooled (models.ts: `!hasCloudKeys() && GATEWAY_URL`).
  if (gatewayUrl && cloud.length === 0) keyless.push(party("sam-cloud", true));

  // DEFAULT_TIER=local keeps ordinary chat on Ollama, but tool-needing turns and explicit tiers can
  // still escalate, so onDevice also requires "no keyed cloud lane". The lists stay authoritative.
  const onDevice = env.DEFAULT_TIER === "local" && cloud.length === 0;
  return { onDevice, cloud, keyless, updated: (deps.now?.() ?? new Date()).toISOString() };
}
