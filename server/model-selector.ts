// ─────────────────────────────────────────────────────────────
//  S.A.M. · DYNAMIC MODEL SELECTOR & ZERO-COST CATALOG
//
//  Antigravity-style bottom model switcher & catalog:
//   1. Out-of-the-box Zero-Cost Free Baseline (Cerebras, Groq, Gemini, Mistral, Ollama)
//   2. High-Performance Fast Lanes (450 tok/s Cerebras, Groq LPU)
//   3. Deep Reasoning Lane (DeepSeek R1, Hermes, Qwen 2.5 72B)
//   4. Bring-Your-Own-Key (BYOK) Premium Tier (Claude 3.5, GPT-4o)
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { poolSize } from "./keys.ts";
import { PROVIDER_REGISTRY } from "./providers.registry.ts";

export interface SelectableModel {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  category: "zero-cost" | "fast" | "reasoning" | "premium-byok";
  description: string;
  speedTokensPerSec: number;
  typicalLatencyMs: number;
  contextWindow: string;
  isReady: boolean;
  isZeroCostBaseline: boolean;
  requiresKey: boolean;
  keyUrl?: string;
  badges: string[];
}

export interface ModelSelectorState {
  activeModelId: string;
  selectedAt: number;
  autoFallbackEnabled: boolean;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VAULT_DIR = () => process.env.VAULT_DIR || join(ROOT, "vault");
const STATE_FILE = () => join(VAULT_DIR(), "model-selection.json");

let activeState: ModelSelectorState = {
  activeModelId: "auto-zero-cost",
  selectedAt: Date.now(),
  autoFallbackEnabled: true,
};

export function loadModelSelection(): ModelSelectorState {
  try {
    if (existsSync(STATE_FILE())) {
      const data = JSON.parse(readFileSync(STATE_FILE(), "utf8"));
      if (data && typeof data.activeModelId === "string") {
        activeState = data;
      }
    }
  } catch {
    // Keep memory default
  }
  return activeState;
}

export function saveModelSelection(state: Partial<ModelSelectorState>): ModelSelectorState {
  activeState = {
    ...activeState,
    ...state,
    selectedAt: Date.now(),
  };

  try {
    mkdirSync(VAULT_DIR(), { recursive: true });
    writeFileSync(STATE_FILE(), JSON.stringify(activeState, null, 2));
  } catch {
    // Best-effort persistence
  }

  return activeState;
}

export const CATALOGUE_MODELS: Omit<SelectableModel, "isReady">[] = [
  // ── 1. AUTOMATIC ARBITRAGE (DEFAULT) ──
  {
    id: "auto-zero-cost",
    name: "⚡ SAM Auto-Arbitrage (Zero-Cost Baseline)",
    provider: "sam-arbitrage",
    providerLabel: "SAM Core",
    category: "zero-cost",
    description: "Automatically routes across 43+ free providers with sub-500ms latency & instant zero-cost fallback.",
    speedTokensPerSec: 450,
    typicalLatencyMs: 380,
    contextWindow: "128k",
    isZeroCostBaseline: true,
    requiresKey: false,
    badges: ["RECOMMENDED", "0-COST BASELINE", "AUTO-ARBITRAGE"],
  },

  // ── 2. ZERO-COST & ULTRA-FAST FREE MODELS ──
  {
    id: "cerebras-llama-70b",
    name: "Cerebras Llama 3.3 70B",
    provider: "cerebras",
    providerLabel: "Cerebras",
    category: "fast",
    description: "World-record 450 tokens/second wafer-scale engine. Instant generation for code and chat.",
    speedTokensPerSec: 450,
    typicalLatencyMs: 280,
    contextWindow: "128k",
    isZeroCostBaseline: true,
    requiresKey: true,
    keyUrl: "https://cloud.cerebras.ai",
    badges: ["⚡ 450 TOK/S", "FREE TIER", "BLAZING"],
  },
  {
    id: "groq-llama-70b",
    name: "Groq Llama 3.3 70B Versatile",
    provider: "groq",
    providerLabel: "Groq",
    category: "fast",
    description: "LPU Inference Engine. Ultra-consistent low-latency responses for complex tools and agent loops.",
    speedTokensPerSec: 300,
    typicalLatencyMs: 350,
    contextWindow: "128k",
    isZeroCostBaseline: true,
    requiresKey: true,
    keyUrl: "https://console.groq.com/keys",
    badges: ["⚡ 300 TOK/S", "FREE TIER", "AGENTIC"],
  },
  {
    id: "gemini-2-5-flash",
    name: "Google Gemini 2.5 Flash",
    provider: "gemini",
    providerLabel: "Google Gemini",
    category: "zero-cost",
    description: "Google's 1-million token multi-modal workhorse. Analyzes images, documents, and code at zero cost.",
    speedTokensPerSec: 180,
    typicalLatencyMs: 450,
    contextWindow: "1M",
    isZeroCostBaseline: true,
    requiresKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    badges: ["👁 1M CONTEXT", "FREE TIER", "VISION"],
  },
  {
    id: "mistral-small",
    name: "Mistral Small / Codestral",
    provider: "mistral",
    providerLabel: "Mistral AI",
    category: "zero-cost",
    description: "European high-precision code & reasoning models with free monthly API tier.",
    speedTokensPerSec: 140,
    typicalLatencyMs: 420,
    contextWindow: "128k",
    isZeroCostBaseline: true,
    requiresKey: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    badges: ["💻 CODE SPECIALIST", "FREE TIER"],
  },
  {
    id: "ollama-local-3b",
    name: "Ollama Resident (llama3.2:3b)",
    provider: "local",
    providerLabel: "Local Hardware",
    category: "zero-cost",
    description: "100% offline local model running in RAM. Zero network, zero tokens, total privacy.",
    speedTokensPerSec: 90,
    typicalLatencyMs: 120,
    contextWindow: "8k",
    isZeroCostBaseline: true,
    requiresKey: false,
    badges: ["🔒 100% PRIVATE", "LOCAL OFFLINE", "NO KEY NEEDED"],
  },

  // ── 3. DEEP REASONING THINKER MODELS ──
  {
    id: "deepseek-r1",
    name: "DeepSeek R1 / V3",
    provider: "deepseek",
    providerLabel: "DeepSeek",
    category: "reasoning",
    description: "Frontier mathematical and chain-of-thought deep reasoning model for complex architectural problems.",
    speedTokensPerSec: 80,
    typicalLatencyMs: 950,
    contextWindow: "64k",
    isZeroCostBaseline: true,
    requiresKey: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
    badges: ["🧠 DEEP REASONING", "CHAIN OF THOUGHT", "MATH & CODE"],
  },
  {
    id: "qwen-2-5-72b",
    name: "Qwen 2.5 72B (Alibaba)",
    provider: "alibaba",
    providerLabel: "Alibaba Cloud",
    category: "reasoning",
    description: "Open-weight powerhouse matching top proprietary benchmarks on code and multilingual tasks.",
    speedTokensPerSec: 110,
    typicalLatencyMs: 650,
    contextWindow: "128k",
    isZeroCostBaseline: true,
    requiresKey: true,
    keyUrl: "https://bailian.console.alibabacloud.com",
    badges: ["🧠 72B WEIGHTS", "FREE CREDITS"],
  },

  // ── 4. PREMIUM BRING-YOUR-OWN-KEY (BYOK) ──
  {
    id: "claude-3-5-sonnet",
    name: "Anthropic Claude 3.5 Sonnet",
    provider: "anthropic",
    providerLabel: "Anthropic",
    category: "premium-byok",
    description: "The gold standard in frontend engineering, architectural synthesis, and nuanced conversational tone.",
    speedTokensPerSec: 90,
    typicalLatencyMs: 600,
    contextWindow: "200k",
    isZeroCostBaseline: false,
    requiresKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    badges: ["👑 BEST UI & CODE", "BYOK", "PREMIUM"],
  },
  {
    id: "gpt-4o",
    name: "OpenAI GPT-4o",
    provider: "openai",
    providerLabel: "OpenAI",
    category: "premium-byok",
    description: "Omni-modal flagship model with strong general capabilities, tools, and structured JSON output.",
    speedTokensPerSec: 100,
    typicalLatencyMs: 550,
    contextWindow: "128k",
    isZeroCostBaseline: false,
    requiresKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    badges: ["👑 OMNI-MODAL", "BYOK", "PREMIUM"],
  },
];

/**
 * Returns the fully hydrated model catalogue with live key availability.
 */
export function getModelSelectorCatalogue(): {
  activeModelId: string;
  zeroCostBaselineCount: number;
  totalModelsCount: number;
  models: SelectableModel[];
} {
  const current = loadModelSelection();

  const models: SelectableModel[] = CATALOGUE_MODELS.map((m) => {
    let isReady = false;

    if (!m.requiresKey) {
      isReady = true;
    } else {
      // Check if provider has active keys pooled or in env
      const count = poolSize(m.provider);
      isReady = count > 0;
    }

    return {
      ...m,
      isReady,
    };
  });

  const zeroCostCount = models.filter((m) => m.isZeroCostBaseline).length;

  return {
    activeModelId: current.activeModelId,
    zeroCostBaselineCount: zeroCostCount,
    totalModelsCount: models.length,
    models,
  };
}
