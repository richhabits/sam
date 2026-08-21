import { describe, it, expect } from "vitest";
import {
  conductDeepResearch,
  compileExecutiveDossier,
  extractDomainFromUrl,
  calculateConsensusScore,
  type DeepResearchReport,
} from "./deep-research.ts";

describe("S.A.M. Deep Research Executive Dossier Engine", () => {
  it("extracts clean domain names from URLs", () => {
    expect(extractDomainFromUrl("https://www.nature.com/articles/d41586-024-001")).toBe("nature.com");
    expect(extractDomainFromUrl("https://arxiv.org/abs/2401.0001")).toBe("arxiv.org");
    expect(extractDomainFromUrl("invalid-url")).toBe("web");
  });

  it("calculates consensus scores based on distinct source ratio", () => {
    expect(calculateConsensusScore(0, 0)).toBe(0);
    // 3 findings from 3 distinct sources -> high ratio
    expect(calculateConsensusScore(3, 3)).toBeGreaterThanOrEqual(80);
    // 3 findings all from 1 source -> lower ratio
    expect(calculateConsensusScore(3, 1)).toBeLessThan(60);
  });

  it("compiles a structured report into a cited markdown dossier", () => {
    const mockReport: DeepResearchReport = {
      topic: "Autonomous AI Coding Agents 2026",
      depth: "deep",
      executiveSummary: "Autonomous AI agents have transitioned from single-prompt chat interfaces to DAG execution engines [1].",
      keyFindings: [
        {
          claim: "Multi-agent DAG topological waves reduce latency by 60%",
          sourceIndex: 1,
          confidence: 0.95,
        },
        {
          claim: "Local micro-solvers eliminate 30% of unnecessary cloud LLM token burn",
          sourceIndex: 2,
          confidence: 0.9,
        },
      ],
      consensusConfidencePct: 85,
      dissentingOrConflictingViews: [
        "Network latency on remote APIs can bottleneck real-time agent loops.",
      ],
      sources: [
        { index: 1, title: "Nature AI Benchmarks", url: "https://nature.com/ai/benchmarks-2026" },
        { index: 2, title: "IEEE Micro-Solver Analysis", url: "https://ieee.org/papers/solver-2026" },
      ],
      suggestedFollowups: [
        "Deploy local zero-token micro solver in production.",
      ],
    };

    const dossier = compileExecutiveDossier(mockReport);

    expect(dossier.title).toContain("Autonomous AI Coding Agents 2026");
    expect(dossier.distinctDomainsCount).toBe(2);
    expect(dossier.consensusScorePct).toBe(85);
    expect(dossier.markdownDossier).toContain("# 📑 EXECUTIVE RESEARCH DOSSIER");
    expect(dossier.markdownDossier).toContain("Nature AI Benchmarks");
    expect(dossier.markdownDossier).toContain("<https://nature.com/ai/benchmarks-2026>");
  });

  it("conducts deep research with injected search & synthesis dependencies", async () => {
    const mockSearch = async (q: string) => {
      return `• Autonomous Agents Architecture — Multi-agent DAG execution review\n  https://arxiv.org/abs/2401.12345`;
    };

    const mockSynthesize = async (system: string, prompt: string) => {
      return {
        text: JSON.stringify({
          executiveSummary: "Multi-agent systems achieve high autonomy when scheduled via DAGs [1].",
          keyFindings: [
            {
              claim: "DAG scheduling ensures linear task resolution without cycle deadlocks",
              sourceIndex: 1,
              confidence: 0.92,
            },
          ],
          dissentingOrConflictingViews: [],
          suggestedFollowups: ["Benchmark token efficiency against single agent loops."],
        }),
      };
    };

    const report = await conductDeepResearch("Autonomous Agent DAGs", {
      search: mockSearch,
      synthesize: mockSynthesize,
    }, { depth: "quick" });

    expect(report.topic).toBe("Autonomous Agent DAGs");
    expect(report.sources.length).toBe(1);
    expect(report.keyFindings.length).toBe(1);
    expect(report.keyFindings[0].claim).toContain("DAG scheduling");
  });
});
