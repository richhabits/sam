import { describe, it, expect, beforeEach } from "vitest";
import {
  probeProvider,
  getSpeedLeaderboard,
  record,
  health,
  _reset,
} from "./speed.ts";

describe("S.A.M. Speed & Active Probe Benchmarking", () => {
  beforeEach(() => {
    _reset();
  });

  it("probes a fast provider and calculates TTFT + tokens/sec", async () => {
    const mockRunner = async () => {
      return {
        text: "The autonomous agent mesh completed execution in record time with zero errors.",
        ttftMs: 45,
      };
    };

    const res = await probeProvider("groq-llama-3.3", mockRunner);

    expect(res.ok).toBe(true);
    expect(res.providerId).toBe("groq-llama-3.3");
    expect(res.ttftMs).toBe(45);
    expect(res.totalMs).toBeGreaterThanOrEqual(0);
    expect(res.tokensPerSec).toBeGreaterThan(0);

    const h = health("groq-llama-3.3");
    expect(h).toBeDefined();
    expect(h?.ok).toBe(1);
  });

  it("handles degraded provider failure and records status", async () => {
    const failingRunner = async () => {
      const err = new Error("Rate limit exceeded");
      (err as any).status = 429;
      throw err;
    };

    const res = await probeProvider("slow-provider", failingRunner);

    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);

    const h = health("slow-provider");
    expect(h).toBeDefined();
    expect(h?.ok).toBe(0);
    expect(h?.calls).toBe(1);
  });

  it("generates leaderboard with fastest provider ranking", () => {
    record("provider-fast", { ms: 60, ok: true, tokensPerSec: 180 });
    record("provider-medium", { ms: 250, ok: true, tokensPerSec: 80 });
    record("provider-broken", { ms: 500, ok: false, status: 404 });

    const leaderboard = getSpeedLeaderboard();
    expect(leaderboard.probedCount).toBe(3);
    expect(leaderboard.activeCount).toBe(2);
    expect(leaderboard.fastestProvider).toBe("provider-fast");
  });
});
