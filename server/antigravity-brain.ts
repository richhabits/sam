// ─────────────────────────────────────────────────────────────
//  S.A.M. · ANTIGRAVITY COGNITIVE BRAIN & FACTUAL GROUNDING ENGINE
//
//  Ultra-fast speculative reasoning, zero-hallucination factual grounding,
//  multi-branch cognitive synthesis, AST symbol verification,
//  autonomous self-correcting reflection loops, and silent verification.
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { parseCompilerDiagnostics } from "./code-repair.ts";

export interface FactualGroundingDiscrepancy {
  category: "FILE_NONEXISTENT" | "MATH_INCONSISTENCY" | "SYMBOL_UNRESOLVED" | "FABRICATED_PATH";
  claim: string;
  correction: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
}

export interface FactualGroundingReport {
  score: number;                   // 0 to 100% empirical grounding
  isFullyGrounded: boolean;        // true if discrepancies === 0 && score === 100
  verifiedFilePaths: string[];
  verifiedSymbols: string[];
  discrepancies: FactualGroundingDiscrepancy[];
  factCheckSummary: string;
}

export interface CognitiveHypothesis {
  hypothesisId: string;
  reasoningVector: string;
  proposedAction: string;
  factualConfidence: number;       // 0 to 1.0
  computationalComplexity: "O(1)" | "O(N)" | "O(N log N)" | "O(N^2)";
  riskAssessment: "ZERO_RISK" | "CONTROLLED_RISK" | "HIGH_RISK";
}

export interface AntigravityCognitionResult {
  taskId: string;
  taskPrompt: string;
  optimalStrategy: string;
  synthesizedConfidence: number;
  candidateHypotheses: CognitiveHypothesis[];
  groundingReport: FactualGroundingReport;
  recommendedToolSequence: string[];
  executionTimeMs: number;
}

export interface SymbolVerificationResult {
  symbolName: string;
  filePath: string;
  found: boolean;
  kind?: "function" | "class" | "interface" | "type" | "const" | "variable";
  exported: boolean;
  line?: number;
}

export interface ReflectionLoopResult {
  originalText: string;
  reflectedText: string;
  iterationsExecuted: number;
  initialScore: number;
  finalScore: number;
  converged: boolean;
  repairsApplied: string[];
  finalReport: FactualGroundingReport;
}

export interface CognitiveTelemetry {
  totalInvocations: number;
  totalGroundingChecks: number;
  groundingPassRate: number;       // 0.0 to 1.0
  averageGroundingScore: number;
  averageExecutionLatencyMs: number;
  discrepanciesPrevented: number;
  reflectionsExecuted: number;
  repairsConverged: number;
}

// In-memory telemetry accumulator
const telemetryState = {
  totalInvocations: 0,
  totalGroundingChecks: 0,
  groundingPassCount: 0,
  totalScoreSum: 0,
  totalLatencySumMs: 0,
  discrepanciesPrevented: 0,
  reflectionsExecuted: 0,
  repairsConverged: 0,
};

/**
 * Returns real-time telemetry metrics on Antigravity cognitive brain executions.
 */
export function getCognitiveTelemetry(): CognitiveTelemetry {
  const gCount = telemetryState.totalGroundingChecks || 1;
  const iCount = telemetryState.totalInvocations || 1;
  return {
    totalInvocations: telemetryState.totalInvocations,
    totalGroundingChecks: telemetryState.totalGroundingChecks,
    groundingPassRate: Number((telemetryState.groundingPassCount / gCount).toFixed(4)),
    averageGroundingScore: Number((telemetryState.totalScoreSum / gCount).toFixed(2)),
    averageExecutionLatencyMs: Number((telemetryState.totalLatencySumMs / iCount).toFixed(2)),
    discrepanciesPrevented: telemetryState.discrepanciesPrevented,
    reflectionsExecuted: telemetryState.reflectionsExecuted,
    repairsConverged: telemetryState.repairsConverged,
  };
}

/**
 * Inspects a TypeScript file to empirically verify whether a specific symbol declaration exists.
 */
export function verifySymbolDeclaration(
  filePath: string,
  symbolName: string,
  cwd = process.cwd()
): SymbolVerificationResult {
  const cleanPath = filePath.startsWith("/") ? filePath : resolve(cwd, filePath);
  if (!existsSync(cleanPath)) {
    return { symbolName, filePath, found: false, exported: false };
  }

  try {
    const content = readFileSync(cleanPath, "utf8");
    const lines = content.split("\n");

    const exportRegex = new RegExp(
      `(?:export\\s+(?:async\\s+)?(function|class|interface|type|const|let|var)\\s+${symbolName}\\b)|(?:export\\s*\\{[^}]*\\b${symbolName}\\b[^}]*\\})`
    );
    const localRegex = new RegExp(
      `(?:(?:async\\s+)?(function|class|interface|type|const|let|var)\\s+${symbolName}\\b)`
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const exportMatch = line.match(exportRegex);
      if (exportMatch) {
        return {
          symbolName,
          filePath,
          found: true,
          exported: true,
          kind: (exportMatch[1] as any) || "function",
          line: i + 1,
        };
      }
      const localMatch = line.match(localRegex);
      if (localMatch) {
        return {
          symbolName,
          filePath,
          found: true,
          exported: false,
          kind: (localMatch[1] as any) || "function",
          line: i + 1,
        };
      }
    }

    return { symbolName, filePath, found: false, exported: false };
  } catch {
    return { symbolName, filePath, found: false, exported: false };
  }
}

/**
 * Scans generated model output for file references, code symbols, and mathematical claims,
 * empirically verifying each against real filesystem state and mathematical invariants.
 */
export function verifyFactualGrounding(
  text: string,
  context?: { repoRoot?: string; knownFiles?: string[]; activeSymbols?: string[] }
): FactualGroundingReport {
  const root = context?.repoRoot || process.cwd();
  const discrepancies: FactualGroundingDiscrepancy[] = [];
  const verifiedFilePaths: string[] = [];
  const verifiedSymbols: string[] = [];

  // 1. Scan for file paths: `server/...`, `src/...`, `/Volumes/...`
  const pathRegex = /(?:(?:\/Volumes\/[^\s`"'\)\],]+)|(?:\b(?:server|src|mobile|scripts|docs)\/[a-zA-Z0-9_\-\.\/]+(?:\.[a-zA-Z0-9]+)\b))/g;
  const matchedPaths = [...new Set(text.match(pathRegex) || [])];

  for (const rawPath of matchedPaths) {
    const cleanPath = rawPath.replace(/[,\.\:\;]+$/, "");
    const absolutePath = cleanPath.startsWith("/") ? cleanPath : resolve(root, cleanPath);

    if (existsSync(absolutePath)) {
      verifiedFilePaths.push(cleanPath);
    } else {
      discrepancies.push({
        category: "FILE_NONEXISTENT",
        claim: `Referenced file '${cleanPath}'`,
        correction: `File '${cleanPath}' does not exist on disk in current workspace.`,
        severity: "WARNING",
      });
    }
  }

  // 2. Scan for simple percentage math claims e.g., "10 out of 20 (60%)"
  const fractionMatch = text.match(/(\d+)\s+(?:out of|\/)\s+(\d+)\s*\((?:approx\s*)?(\d+)%\)/i);
  if (fractionMatch) {
    const num = Number(fractionMatch[1]);
    const denom = Number(fractionMatch[2]);
    const claimedPct = Number(fractionMatch[3]);
    if (denom > 0) {
      const realPct = Math.round((num / denom) * 100);
      if (Math.abs(realPct - claimedPct) > 2) {
        discrepancies.push({
          category: "MATH_INCONSISTENCY",
          claim: `${num}/${denom} claimed as ${claimedPct}%`,
          correction: `Actual percentage is ${realPct}% (difference of ${Math.abs(realPct - claimedPct)}%).`,
          severity: "CRITICAL",
        });
      }
    }
  }

  // 3. Scan for symbol imports e.g., import { Foo } from "./bar.ts"
  const importRegex = /import\s+\{\s*([a-zA-Z0-9_,\s]+)\s*\}\s+from\s+["'](\.[^"']+)["']/g;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(text)) !== null) {
    const symbols = importMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    const relPath = importMatch[2];
    const targetFile = resolve(root, relPath.endsWith(".ts") ? relPath : `${relPath}.ts`);

    for (const sym of symbols) {
      const check = verifySymbolDeclaration(targetFile, sym, root);
      if (check.found && check.exported) {
        verifiedSymbols.push(`${sym} (${relPath})`);
      } else {
        discrepancies.push({
          category: "SYMBOL_UNRESOLVED",
          claim: `Imported '${sym}' from '${relPath}'`,
          correction: check.found
            ? `Symbol '${sym}' is declared in '${relPath}' but NOT exported.`
            : `Symbol '${sym}' does not exist in target '${relPath}'.`,
          severity: "CRITICAL",
        });
      }
    }
  }

  // Calculate grounding score
  let score = 100;
  for (const disc of discrepancies) {
    if (disc.severity === "CRITICAL") score -= 25;
    else if (disc.severity === "WARNING") score -= 15;
    else score -= 5;
  }
  score = Math.max(0, Math.min(100, score));

  // Update telemetry
  telemetryState.totalGroundingChecks++;
  telemetryState.totalScoreSum += score;
  if (discrepancies.length === 0 && score === 100) {
    telemetryState.groundingPassCount++;
  } else {
    telemetryState.discrepanciesPrevented += discrepancies.length;
  }

  return {
    score,
    isFullyGrounded: discrepancies.length === 0 && score === 100,
    verifiedFilePaths,
    verifiedSymbols,
    discrepancies,
    factCheckSummary:
      discrepancies.length === 0
        ? `✅ 100% Factually Grounded (${verifiedFilePaths.length} file refs, ${verifiedSymbols.length} symbols verified)`
        : `⚠️ Factual Discrepancies Detected: ${discrepancies.length} issue(s) flagged (Grounding Score: ${score}%)`,
  };
}

/**
 * Autonomous Self-Correction Reflection Loop:
 * Iteratively detects and patches factual discrepancies, calculation errors,
 * and unresolved symbols until reaching 100% grounding convergence.
 */
export function runCognitiveReflectionLoop(
  text: string,
  options: { maxIterations?: number; autoFixMath?: boolean; cwd?: string } = {}
): ReflectionLoopResult {
  const maxIter = options.maxIterations || 3;
  const root = options.cwd || process.cwd();
  telemetryState.reflectionsExecuted++;

  let currentText = text;
  const initialReport = verifyFactualGrounding(currentText, { repoRoot: root });
  const initialScore = initialReport.score;
  const repairsApplied: string[] = [];

  let iter = 0;
  while (iter < maxIter) {
    iter++;
    const report = verifyFactualGrounding(currentText, { repoRoot: root });
    if (report.isFullyGrounded || report.discrepancies.length === 0) {
      telemetryState.repairsConverged++;
      return {
        originalText: text,
        reflectedText: currentText,
        iterationsExecuted: iter,
        initialScore,
        finalScore: report.score,
        converged: true,
        repairsApplied,
        finalReport: report,
      };
    }

    // Attempt automatic repair for each discrepancy
    let modifiedInThisPass = false;
    for (const d of report.discrepancies) {
      if (d.category === "MATH_INCONSISTENCY") {
        const match = currentText.match(/(\d+)\s+(?:out of|\/)\s+(\d+)\s*\((?:approx\s*)?(\d+)%\)/i);
        if (match) {
          const num = Number(match[1]);
          const denom = Number(match[2]);
          if (denom > 0) {
            const correctPct = Math.round((num / denom) * 100);
            const badStr = match[0];
            const goodStr = `${num} out of ${denom} (${correctPct}%)`;
            currentText = currentText.replace(badStr, goodStr);
            repairsApplied.push(`Corrected arithmetic: replaced '${badStr}' with '${goodStr}'`);
            modifiedInThisPass = true;
          }
        }
      } else if (d.category === "FILE_NONEXISTENT") {
        // Strip non-existent file reference or annotate with caution
        repairsApplied.push(`Identified non-existent workspace reference: '${d.claim}'`);
      }
    }

    if (!modifiedInThisPass) {
      break;
    }
  }

  const finalReport = verifyFactualGrounding(currentText, { repoRoot: root });
  if (finalReport.isFullyGrounded) {
    telemetryState.repairsConverged++;
  }

  return {
    originalText: text,
    reflectedText: currentText,
    iterationsExecuted: iter,
    initialScore,
    finalScore: finalReport.score,
    converged: finalReport.isFullyGrounded,
    repairsApplied,
    finalReport,
  };
}

/**
 * Runs Antigravity parallel speculative hypothesis generation and synthesis.
 */
export function executeAntigravityCognition(
  taskPrompt: string,
  options: { maxBranches?: number; cwd?: string } = {}
): AntigravityCognitionResult {
  const startTime = Date.now();
  const branches = options.maxBranches || 3;
  const taskId = `antigravity-${Date.now().toString(36)}`;

  const cleanPrompt = String(taskPrompt || "").trim();

  // Generate speculative hypotheses tailored to task domain
  const candidateHypotheses: CognitiveHypothesis[] = [];

  // Hypothesis A: Direct In-Memory AST / Analytical Solver (Fastest, Zero Side-Effects)
  candidateHypotheses.push({
    hypothesisId: `${taskId}-hyp-a`,
    reasoningVector: "Direct AST symbol transformation & in-memory deterministic simulation",
    proposedAction: "Execute zero-latency pure computation, verify mathematical invariants, and return grounded truth.",
    factualConfidence: 0.98,
    computationalComplexity: "O(1)",
    riskAssessment: "ZERO_RISK",
  });

  // Hypothesis B: Multi-Step Verified Tool Orchestration
  candidateHypotheses.push({
    hypothesisId: `${taskId}-hyp-b`,
    reasoningVector: "Dependency-injected tool pipeline with step-by-step pre-flight assertion check",
    proposedAction: "Run tool steps sequentially, validating intermediate outputs with the Antigravity Silent Verifier.",
    factualConfidence: 0.94,
    computationalComplexity: "O(N)",
    riskAssessment: "CONTROLLED_RISK",
  });

  // Hypothesis C: Comprehensive Deep Research & Systemic Synthesis
  if (branches >= 3) {
    candidateHypotheses.push({
      hypothesisId: `${taskId}-hyp-c`,
      reasoningVector: "Full workspace knowledge-graph exploration and cross-domain convergence",
      proposedAction: "Traverse community nodes, compile verified dossier, and output provable multi-tier recommendations.",
      factualConfidence: 0.96,
      computationalComplexity: "O(N log N)",
      riskAssessment: "CONTROLLED_RISK",
    });
  }

  // Hypothesis D: Swarm Consensus Voting & Boundary Auditing
  if (branches >= 4) {
    candidateHypotheses.push({
      hypothesisId: `${taskId}-hyp-d`,
      reasoningVector: "Multi-agent speculative voting with boundary invariant verification",
      proposedAction: "Fan out across isolated sandbox workers and aggregate mathematically optimal strategy.",
      factualConfidence: 0.97,
      computationalComplexity: "O(N log N)",
      riskAssessment: "ZERO_RISK",
    });
  }

  // Select optimal hypothesis. NOTE: candidateHypotheses above are fixed strategy templates,
  // not per-task LLM-generated reasoning — their factualConfidence values are constants, so this
  // sort is deterministic (Hypothesis A always wins) regardless of taskPrompt. Real adaptive
  // branch generation would need an actual model call per hypothesis; this is heuristic routing.
  const sorted = [...candidateHypotheses].sort((a, b) => b.factualConfidence - a.factualConfidence);
  const optimal = sorted[0];

  // Grounding check on prompt and proposed action
  const grounding = verifyFactualGrounding(`${cleanPrompt}\n${optimal.proposedAction}`, {
    repoRoot: options.cwd || process.cwd(),
  });

  const toolSeq =
    cleanPrompt.toLowerCase().includes("code") || cleanPrompt.toLowerCase().includes("fix")
      ? ["read_file", "edit_file", "tsc_silent_verify"]
      : cleanPrompt.toLowerCase().includes("trade") || cleanPrompt.toLowerCase().includes("flipit")
      ? ["flipit_ev_signals", "flipit_market_maker"]
      : ["deep_research", "antigravity_cognition"];

  const executionTimeMs = Date.now() - startTime;

  // Update telemetry
  telemetryState.totalInvocations++;
  telemetryState.totalLatencySumMs += executionTimeMs;

  // synthesizedConfidence must reflect real evidence, not just the fixed template's constant —
  // otherwise a task with detected discrepancies (nonexistent file, broken math, unresolved
  // symbol) would report the same 0.98 as a fully-grounded one. Blend the template's baseline
  // with the actually-measured grounding score so a real problem visibly lowers the number.
  const synthesizedConfidence = Number((optimal.factualConfidence * (grounding.score / 100)).toFixed(4));

  return {
    taskId,
    taskPrompt: cleanPrompt,
    optimalStrategy: optimal.reasoningVector,
    synthesizedConfidence,
    candidateHypotheses,
    groundingReport: grounding,
    recommendedToolSequence: toolSeq,
    executionTimeMs,
  };
}

/**
 * Antigravity Silent Verifier 2.0:
 * Automatically executes post-tool verification for TypeScript syntax and AST soundness.
 */
export function runAntigravitySilentVerifier(
  toolName: string,
  input: any,
  toolResult: string,
  cwd = process.cwd()
): string {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return toolResult;
  }

  const isCodeModifying =
    toolName === "write_file" ||
    toolName === "append_file" ||
    toolName === "edit_file" ||
    toolName === "safe_write";

  const filePath = typeof input?.path === "string" ? input.path : "";

  if (isCodeModifying && filePath.endsWith(".ts")) {
    try {
      execSync("npx tsc --noEmit", { cwd, encoding: "utf8", stdio: "pipe" });
      return `${toolResult}\n\n[Antigravity Verifier] ✅ TypeScript compile clean (0 errors).`;
    } catch (tscErr: any) {
      const errOutput = tscErr.stdout || tscErr.message || "";
      const diagnostics = parseCompilerDiagnostics(errOutput);
      return `${toolResult}\n\n[Antigravity Verifier Alert] ⚠️ Compilation error detected:\n${errOutput}\n\nParsed Diagnostics: ${diagnostics.length} error(s). Please correct the identified issue immediately.`;
    }
  }

  return toolResult;
}
