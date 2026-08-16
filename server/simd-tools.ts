// ─────────────────────────────────────────────────────────────
//  S.A.M. · PARALLEL SIMD TOOL DISPATCHER
//
//  Dispatches independent safe: true tools simultaneously via
//  Promise.allSettled, cutting multi-tool execution latency from
//  seconds to milliseconds.
// ─────────────────────────────────────────────────────────────

export interface SimdToolCall {
  name: string;
  args?: any;
}

export interface SimdToolExecutionResult {
  tool: string;
  status: "fulfilled" | "rejected";
  durationMs: number;
  output: string;
}

export interface SimdBatchReport {
  totalTools: number;
  completedCount: number;
  failedCount: number;
  wallClockDurationMs: number;
  sequentialEstimatedMs: number;
  speedupFactor: number;
  results: SimdToolExecutionResult[];
}

export async function executeSimdToolBatch(
  toolCalls: SimdToolCall[],
  runner: (name: string, args: any) => Promise<string>
): Promise<SimdBatchReport> {
  const start = Date.now();
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return {
      totalTools: 0,
      completedCount: 0,
      failedCount: 0,
      wallClockDurationMs: 0,
      sequentialEstimatedMs: 0,
      speedupFactor: 1.0,
      results: [],
    };
  }

  // Cap batch size to 25 to prevent overwhelming local event loop
  const boundedCalls = toolCalls.slice(0, 25);

  const promises = boundedCalls.map(async (tc): Promise<SimdToolExecutionResult> => {
    const t0 = Date.now();
    try {
      const out = await runner(tc.name, tc.args);
      const dt = Date.now() - t0;
      return {
        tool: tc.name,
        status: "fulfilled",
        durationMs: Math.max(1, dt),
        output: String(out || ""),
      };
    } catch (e: any) {
      const dt = Date.now() - t0;
      return {
        tool: tc.name,
        status: "rejected",
        durationMs: Math.max(1, dt),
        output: `Error: ${e?.message ?? e}`,
      };
    }
  });

  const settled = await Promise.all(promises);
  const wallClock = Math.max(1, Date.now() - start);

  const completed = settled.filter(r => r.status === "fulfilled").length;
  const failed = settled.filter(r => r.status === "rejected").length;
  const sequentialSum = settled.reduce((acc, r) => acc + r.durationMs, 0);
  const speedup = Number((sequentialSum / Math.max(1, wallClock)).toFixed(2));

  return {
    totalTools: boundedCalls.length,
    completedCount: completed,
    failedCount: failed,
    wallClockDurationMs: wallClock,
    sequentialEstimatedMs: sequentialSum,
    speedupFactor: speedup > 0 ? speedup : 1.0,
    results: settled,
  };
}
