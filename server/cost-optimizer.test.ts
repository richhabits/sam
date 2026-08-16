import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordCostSavings,
  getSavingsSummary,
  resetSavingsLedger,
  compressPromptForCost,
  auditCapitalProtection,
} from "./cost-optimizer.ts";
import {
  costSavingsReportTool,
  optimizePromptTokensTool,
  capitalProtectionAuditTool,
} from "./tools.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sam-cost-test-"));
  process.env.VAULT_DIR = dir;
  resetSavingsLedger();
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("Cost Optimizer & Capital Preservation Suite", () => {
  describe("Savings Ledger & Dollar Math", () => {
    it("accumulates free-tier and cache-hit token and dollar savings", () => {
      // 1M free input tokens + 200k free output tokens
      recordCostSavings({
        provider: "pollinations",
        isFreeTier: true,
        inputTokens: 1_000_000,
        outputTokens: 200_000,
      });

      // Semantic cache hit: 500k input tokens + 100k output tokens
      recordCostSavings({
        provider: "cache",
        isFreeTier: false,
        isCacheHit: true,
        inputTokens: 500_000,
        outputTokens: 100_000,
      });

      const summary = getSavingsSummary();
      expect(summary.ledger.totalRequests).toBe(2);
      expect(summary.ledger.freeTierRequests).toBe(1);
      expect(summary.ledger.cachedRequests).toBe(1);
      expect(summary.freeEfficiencyPercentage).toBe(50.0);
      expect(summary.cacheEfficiencyPercentage).toBe(50.0);

      // Dollars saved calculation:
      // Request 1: (1.0 * $3.0) + (0.2 * $12.0) = $3.0 + $2.4 = $5.40
      // Request 2: (0.5 * $3.0) + (0.1 * $12.0) = $1.5 + $1.2 = $2.70
      // Total = $8.10
      expect(summary.ledger.dollarsSavedTotal).toBeCloseTo(8.10, 2);
      expect(summary.estimatedGbpSaved).toBeGreaterThan(0);
    });
  });

  describe("Prompt Context Compression", () => {
    it("compresses repeated lines and redundant spaces to save tokens", () => {
      const bloatedText = `
        System status OK
        System status OK
        System status OK
        Connecting to gateway server...   with extra padding
        Connecting to gateway server...   with extra padding
        
        Final report ready.
      `;

      const res = compressPromptForCost(bloatedText);

      expect(res.compressedLength).toBeLessThan(res.originalLength);
      expect(res.tokensSaved).toBeGreaterThan(0);
      expect(res.reductionPercentage).toBeGreaterThan(10);
      expect(res.compressedText).toContain("Final report ready.");
    });

    it("handles empty or whitespace text gracefully", () => {
      const res = compressPromptForCost("");
      expect(res.originalLength).toBe(0);
      expect(res.tokensSaved).toBe(0);
    });
  });

  describe("Capital Protection Circuit Breakers", () => {
    it("evaluates safe equity and returns positive Kelly sizing", () => {
      const audit = auditCapitalProtection({
        equity: 100,
        highWaterMark: 100,
        winRate: 0.6,
        profitFactor: 2.0,
      });

      expect(audit.status).toBe("SAFE");
      expect(audit.currentDrawdown).toBe(0);
      expect(audit.recommendedMaxBetFraction).toBeGreaterThan(0);
    });

    it("triggers caution and circuit breaker on severe drawdowns", () => {
      // 10% drawdown with 15% limit -> CAUTION
      const cautionAudit = auditCapitalProtection({
        equity: 90,
        highWaterMark: 100,
        maxDrawdownLimit: 0.15,
      });
      expect(cautionAudit.status).toBe("CAUTION");
      expect(cautionAudit.riskWarning).toContain("Warning");

      // 20% drawdown with 15% limit -> CIRCUIT BREAKER
      const trippedAudit = auditCapitalProtection({
        equity: 80,
        highWaterMark: 100,
        maxDrawdownLimit: 0.15,
      });
      expect(trippedAudit.status).toBe("CIRCUIT_BREAKER_TRIGGERED");
      expect(trippedAudit.riskWarning).toContain("EMERGENCY STOP");
    });
  });

  describe("Cost Tools in TOOLS", () => {
    it("runs costSavingsReportTool", async () => {
      const out = await costSavingsReportTool();
      expect(out).toContain("SAM Cost & Token Savings Ledger");
      expect(out).toContain("Free-Tier Routing Efficiency");
      expect(out).toContain("Estimated Dollars Saved");
    });

    it("runs optimizePromptTokensTool", async () => {
      const out = await optimizePromptTokensTool({
        text: "Line 1\nLine 1\nLine 1\nLine 2",
      });
      expect(out).toContain("Prompt Token Optimization Summary");
      expect(out).toContain("Tokens Saved");
    });

    it("runs capitalProtectionAuditTool", async () => {
      const out = await capitalProtectionAuditTool({
        equity: 50,
        highWaterMark: 60,
      });
      expect(out).toContain("Capital Protection & Risk Circuit Breaker");
      expect(out).toContain("Drawdown:");
      expect(out).toContain("Circuit Breaker Status:");
    });
  });
});
