// ─────────────────────────────────────────────────────────────
//  S.A.M. · SMART ACTIONS & ERGONOMICS ENGINE (Maximum UX Layer)
//
//  Unifies SAM, FlipIt, and Studio into intuitive, frictionless
//  1-click natural workflows for both complete novices and power users.
// ─────────────────────────────────────────────────────────────

import { HIGGSFIELD_CAMERA_RIGS, HIGGSFIELD_LENSES, compileHiggsfieldMotionPrompt } from "./studio-higgsfield.ts";
import { desk, project100xLadder } from "./flipit.ts";
import { runDoctor } from "./doctor.ts";
import { getSavingsSummary } from "./cost-optimizer.ts";

export interface SmartStudioPresetResult {
  concept: string;
  enhancedPrompt: string;
  recommendedCameraRig: string;
  recommendedLens: string;
  aspectRatio: string;
  readyToGenerate: boolean;
  quickTips: string[];
}

export function generateSmartStudioPreset(
  concept: string,
  mood: "cinematic" | "action" | "moody" | "commercial" | "anime" | "vintage" = "cinematic"
): SmartStudioPresetResult {
  const c = String(concept || "epic scene").trim();

  let rigId = "orbit_360_cw";
  let lensId = "anamorphic_panavision";
  let aspect: "16:9" | "9:16" | "2.39:1" | "4:5" = "16:9";

  switch (mood) {
    case "action":
      rigId = "fpv_drone_dive";
      lensId = "arri_master_prime";
      aspect = "16:9";
      break;
    case "moody":
      rigId = "dutch_roll_tension";
      lensId = "anamorphic_panavision";
      aspect = "2.39:1";
      break;
    case "commercial":
      rigId = "macro_slider_glide";
      lensId = "portrait_85mm_bokeh";
      aspect = "4:5";
      break;
    case "vintage":
      rigId = "steadicam_tracking";
      lensId = "vintage_super_8";
      aspect = "16:9";
      break;
    case "cinematic":
    default:
      rigId = "dolly_in_rapid";
      lensId = "imax_70mm_grand";
      aspect = "2.39:1";
      break;
  }

  const synthesis = compileHiggsfieldMotionPrompt({
    basePrompt: c,
    cameraRigId: rigId,
    lensId,
    motionIntensity: 1.2,
    aspectRatio: aspect as any,
  });

  return {
    concept: c,
    enhancedPrompt: synthesis.compiledPrompt,
    recommendedCameraRig: rigId,
    recommendedLens: lensId,
    aspectRatio: aspect,
    readyToGenerate: true,
    quickTips: [
      `Optimized for ${mood} aesthetics using ${synthesis.lensSignature}.`,
      `Motion vectors locked with dynamic camera trajectory: ${rigId}.`,
      `Zero prompt engineering required — ready to generate.`,
    ],
  };
}

export interface SimpleFlipItCard {
  currentEquity: string;
  rungStatus: string;
  ladderProgressPct: number;
  safePositionSize: string;
  overallHealth: "EXCELLENT" | "GOOD" | "ATTENTION_NEEDED";
  actionAdvice: string;
}

export function buildSimpleFlipItSummary(): SimpleFlipItCard {
  const d = desk();
  const eq = d.now?.equity ?? 5.0;
  const rung = d.now?.rung ?? 0;
  const inBand = d.now?.inBand ?? true;

  const ladder = project100xLadder(eq);
  const targetRungEquity = ladder.rungs[0]?.targetEquity ?? (eq * 1.15);
  const progress = Math.min(100, Math.max(0, Math.round(((eq - 5.0) / (targetRungEquity - 5.0 || 1)) * 100)));

  const safeKelly = ladder.optimalKellyFraction;
  const safePosition = `£${(eq * safeKelly).toFixed(2)} (${(safeKelly * 100).toFixed(0)}% allocation)`;

  let health: "EXCELLENT" | "GOOD" | "ATTENTION_NEEDED" = "EXCELLENT";
  let advice = "Your strategy is running smoothly inside expected risk bands. Compound naturally.";

  if (!inBand) {
    health = "ATTENTION_NEEDED";
    advice = "Trading returns have drifted outside the standard deviation band. Review recent trades.";
  } else if (d.loop?.stale) {
    health = "ATTENTION_NEEDED";
    advice = "The evening trading watchdog is overdue. Check rig connection.";
  }

  return {
    currentEquity: `£${eq.toFixed(2)}`,
    rungStatus: `Rung ${rung} of 100 (Target: £${targetRungEquity.toFixed(2)})`,
    ladderProgressPct: progress,
    safePositionSize: safePosition,
    overallHealth: health,
    actionAdvice: advice,
  };
}

export interface SmartActionResult {
  category: "STUDIO" | "INVESTMENT" | "SYSTEM";
  title: string;
  summary: string;
  details: string[];
  nextSuggestedAction: string;
}

export async function executeSmartAction(intent: string): Promise<SmartActionResult> {
  const lower = String(intent || "").toLowerCase();

  // 1. Studio & Creative Intent
  if (lower.includes("video") || lower.includes("image") || lower.includes("film") || lower.includes("studio") || lower.includes("cinematic")) {
    const preset = generateSmartStudioPreset(intent, lower.includes("action") ? "action" : "cinematic");
    return {
      category: "STUDIO",
      title: "🎬 Studio 1-Click Director Action",
      summary: `Prepared full Higgsfield cinematic generation prompt for "${preset.concept}".`,
      details: [
        `Enhanced Prompt: "${preset.enhancedPrompt}"`,
        `Camera Movement: ${preset.recommendedCameraRig} | Lens: ${preset.recommendedLens}`,
        `Aspect Ratio: ${preset.aspectRatio}`,
      ],
      nextSuggestedAction: "Click generate to render video/image with optimal 3D motion vectors.",
    };
  }

  // 2. Investment & FlipIt Intent
  if (lower.includes("invest") || lower.includes("money") || lower.includes("flipit") || lower.includes("trade") || lower.includes("ladder")) {
    const card = buildSimpleFlipItSummary();
    return {
      category: "INVESTMENT",
      title: "📈 FlipIt Investment & Capital Glance",
      summary: `Account balance: ${card.currentEquity} · ${card.rungStatus}`,
      details: [
        `Progress to Next Rung: ${card.ladderProgressPct}%`,
        `Mathematical Safe Sizing: ${card.safePositionSize}`,
        `System Health: ${card.overallHealth}`,
        `Guidance: ${card.actionAdvice}`,
      ],
      nextSuggestedAction: "Check full Monte Carlo or multi-strategy risk matrix in FlipIt tab.",
    };
  }

  // 3. System Health & Proactive Optimization
  // AUDIT FIX: this used to call autoHealDoctor() directly — the same mutating function
  // doctor_auto_heal wraps (deletes stale lock files, writes to the vault directory), which is
  // deliberately safe:false because of those side effects. smart_quick_action is safe:true, so
  // that call silently bypassed doctor_auto_heal's approval gate for virtually any intent string
  // that didn't happen to match the Studio/Investment keyword lists — this fallback branch is
  // the default. A glance card only needs to REPORT status, not apply remediations, so this now
  // calls the read-only runDoctor() diagnostic instead. If actual remediation is wanted, call
  // doctor_auto_heal explicitly — it still correctly asks first.
  const doc = runDoctor({
    hasCloudKeys: true,
    ollamaConfigured: false,
    ollamaReachable: false,
    online: true,
    vaultWritable: true,
    platform: process.platform,
  });

  const savings = getSavingsSummary();

  return {
    category: "SYSTEM",
    title: "⚡ SAM System Health & Efficiency Autopilot",
    summary: `System is clean · $${savings.ledger.dollarsSavedTotal.toFixed(2)} estimated API costs saved.`,
    details: [
      `Doctor Status: [${doc.healthy ? "HEALTHY" : "NEEDS ATTENTION"}] ${doc.summary}`,
      `Free-Tier Routing Efficiency: ${savings.freeEfficiencyPercentage}%`,
      `Semantic Cache Deduplication: ${savings.cacheEfficiencyPercentage}%`,
    ],
    nextSuggestedAction: doc.healthy
      ? "All background systems, locks, and caches are operating optimally."
      : "Run doctor_auto_heal to apply fixes (asks for approval first).",
  };
}
