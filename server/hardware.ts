// ─────────────────────────────────────────────────────────────
//  S.A.M. · HARDWARE DETECTION & LOCAL BRAIN SCALING ENGINE
//
//  Detects system RAM, CPU/GPU architecture (Apple Silicon M-series,
//  Intel/AMD, NVIDIA CUDA), and automatically tailors local model
//  recommendations:
//    · Entry (≤8 GB RAM):     llama3.2:3b, qwen2.5:3b, phi3.5:3.8b (fast, lightweight)
//    · Mid (16–24 GB RAM):    llama3.3:8b, qwen2.5-coder:14b, deepseek-r1:8b/14b
//    · Pro (32–48 GB RAM):    qwen2.5-coder:32b, deepseek-r1:32b, command-r:35b
//    · Ultra / Top Boy (64–128GB+ RAM): llama3.3:70b, qwen2.5:72b, deepseek-r1:70b
// ─────────────────────────────────────────────────────────────

import { execSync } from "node:child_process";
import * as os from "node:os";

export type HardwareTier = "entry" | "mid" | "pro" | "ultra";

export interface ModelRecommendation {
  name: string;
  tag: string;
  parameters: string;
  vramRequiredGB: number;
  specialty: "fast-chat" | "coding" | "deep-reasoning" | "vision" | "heavy-thinker";
  description: string;
  isDefault?: boolean;
}

export interface HardwareProfile {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryGB: number;
  freeMemoryGB: number;
  tier: HardwareTier;
  tierLabel: string;
  appleSilicon: boolean;
  appleChipName?: string;
  recommendedModels: ModelRecommendation[];
}

const TIER_MODELS: Record<HardwareTier, ModelRecommendation[]> = {
  entry: [
    {
      name: "Llama 3.2 3B",
      tag: "llama3.2:3b",
      parameters: "3.2B",
      vramRequiredGB: 2.0,
      specialty: "fast-chat",
      description: "⚡ Ultra-fast general assistant · Fits easily on 8GB machines",
      isDefault: true,
    },
    {
      name: "Qwen 2.5 3B",
      tag: "qwen2.5:3b",
      parameters: "3.0B",
      vramRequiredGB: 1.9,
      specialty: "fast-chat",
      description: "🧠 Multilingual, high-density small thinker",
    },
    {
      name: "Phi 3.5 Mini",
      tag: "phi3.5:3.8b",
      parameters: "3.8B",
      vramRequiredGB: 2.2,
      specialty: "coding",
      description: "💻 Microsoft high-efficiency reasoning model",
    },
  ],
  mid: [
    {
      name: "Llama 3.3 8B",
      tag: "llama3.3:8b",
      parameters: "8B",
      vramRequiredGB: 4.8,
      specialty: "fast-chat",
      description: "⚡ The gold-standard balanced daily assistant",
      isDefault: true,
    },
    {
      name: "Qwen 2.5 Coder 14B",
      tag: "qwen2.5-coder:14b",
      parameters: "14B",
      vramRequiredGB: 9.0,
      specialty: "coding",
      description: "💻 State-of-the-art local coding and architecture engine",
    },
    {
      name: "DeepSeek R1 Distill 14B",
      tag: "deepseek-r1:14b",
      parameters: "14B",
      vramRequiredGB: 9.0,
      specialty: "deep-reasoning",
      description: "🧠 Deep step-by-step chain-of-thought reasoner",
    },
  ],
  pro: [
    {
      name: "Qwen 2.5 Coder 32B",
      tag: "qwen2.5-coder:32b",
      parameters: "32B",
      vramRequiredGB: 20.0,
      specialty: "coding",
      description: "💻 Claude-grade local code generation and refactoring",
      isDefault: true,
    },
    {
      name: "DeepSeek R1 Distill 32B",
      tag: "deepseek-r1:32b",
      parameters: "32B",
      vramRequiredGB: 20.0,
      specialty: "deep-reasoning",
      description: "🧠 Heavy mathematical and architectural logic solver",
    },
    {
      name: "Command R 35B",
      tag: "command-r:35b",
      parameters: "35B",
      vramRequiredGB: 22.0,
      specialty: "fast-chat",
      description: "📚 128k context document synthesis and tool-use",
    },
  ],
  ultra: [
    {
      name: "Llama 3.3 70B",
      tag: "llama3.3:70b",
      parameters: "70B",
      vramRequiredGB: 42.0,
      specialty: "heavy-thinker",
      description: "👑 Flagship open model · Unrivaled local intelligence",
      isDefault: true,
    },
    {
      name: "DeepSeek R1 70B",
      tag: "deepseek-r1:70b",
      parameters: "70B",
      vramRequiredGB: 43.0,
      specialty: "deep-reasoning",
      description: "🧠 Elite frontier reasoning running 100% private in local memory",
    },
    {
      name: "Qwen 2.5 72B",
      tag: "qwen2.5:72b",
      parameters: "72B",
      vramRequiredGB: 43.0,
      specialty: "heavy-thinker",
      description: "🌐 Top-tier multi-domain knowledge and complex synthesis",
    },
  ],
};

function detectAppleChip(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const chip = execSync("sysctl -n machdep.cpu.brand_string", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (chip && chip.includes("Apple")) return chip;
    const model = execSync("sysctl -n hw.model", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return model || "Apple Silicon";
  } catch {
    return process.arch === "arm64" ? "Apple Silicon" : undefined;
  }
}

/**
 * Detects current system hardware specs and assigns an AI compute tier.
 */
export function getHardwareProfile(): HardwareProfile {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const totalGB = Math.round((totalBytes / (1024 * 1024 * 1024)) * 10) / 10;
  const freeGB = Math.round((freeBytes / (1024 * 1024 * 1024)) * 10) / 10;
  const cpus = os.cpus() || [];
  const cpuModel = cpus[0]?.model || os.arch();
  const cpuCores = cpus.length;

  const appleChipName = detectAppleChip();
  const appleSilicon = !!appleChipName || (process.platform === "darwin" && process.arch === "arm64");

  let tier: HardwareTier;
  let tierLabel: string;

  if (totalGB >= 60) {
    tier = "ultra";
    tierLabel = "Top Boy Ultra (64GB+ Unified Memory / High-VRAM)";
  } else if (totalGB >= 28) {
    tier = "pro";
    tierLabel = "Pro Powerhouse (32GB–48GB Unified RAM)";
  } else if (totalGB >= 14) {
    tier = "mid";
    tierLabel = "Balanced System (16GB–24GB RAM)";
  } else {
    tier = "entry";
    tierLabel = "Lightweight / Efficient (≤8GB RAM)";
  }

  const recommendedModels = TIER_MODELS[tier];

  return {
    platform: process.platform,
    arch: process.arch,
    cpuModel,
    cpuCores,
    totalMemoryGB: totalGB,
    freeMemoryGB: freeGB,
    tier,
    tierLabel,
    appleSilicon,
    appleChipName,
    recommendedModels,
  };
}

/**
 * Checks local Ollama instance for pulled models and active readiness.
 */
export async function getOllamaStatus(ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434") {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { online: false, models: [] };
    const data: any = await res.json();
    const models = (data?.models || []).map((m: any) => ({
      name: m.name,
      sizeGB: Math.round(((m.size || 0) / (1024 * 1024 * 1024)) * 10) / 10,
      modifiedAt: m.modified_at,
      digest: m.digest?.slice(0, 12),
    }));
    return { online: true, models };
  } catch {
    return { online: false, models: [] };
  }
}
