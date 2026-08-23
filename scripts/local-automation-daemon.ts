import { checkFlipItAlerts } from "../server/flipit.ts";
import { FlipItLocalSimulator } from "../server/flipit-local-simulator.ts";
import { submitPolymarketClobOrder } from "../server/flipit-execution.ts";
import { processNextStudioJob } from "../server/studio-queue.ts";
import { auditSpaceConsumption, compactSpaceAndMemory } from "../server/space-compactor.ts";
import { prewarmContext } from "../server/prefetch.ts";

console.log("🚀 Starting Local Automation Daemon (Zero-Cost Mode)...");

const TICK_RATE_MS = 60 * 1000; // 1 minute

async function daemonTick() {
  const now = new Date();
  console.log(`[${now.toISOString()}] Daemon tick...`);

  try {
    // 1. FlipIt Alert Checks (Runs locally against state files)
    const alert = await checkFlipItAlerts(now.getTime());
    if (alert) {
      console.log(`[FlipIt] Triggered alert: ${alert}`);
    }

    // 2. Simulated Portfolio Auto-Rebalancer (Paper/Simulated Mode)
    console.log(`[FlipIt Simulator] Generating mock heartbeat transactions to emulate 24/7 market activity...`);
    const sim = new FlipItLocalSimulator();
    
    // Simulate price fluctuation
    sim.simulateOrderBookTick("binance", "BTC/GBP", 60000 + Math.random() * 500, 60010 + Math.random() * 500);
    
    // Actually submit a mock clob order to exercise the execution engine locally and write history
    const res = await submitPolymarketClobOrder(
      { tokenId: "BTC_MOCK_TOKEN", price: 0.5, size: Math.floor(Math.random() * 10) + 1, side: "BUY" },
      { address: "0xSimulatedPaperWallet", apiKey: "SimulatedApiKey" },
      { fetcher: sim.getMockFetcher() as any }
    );
    
    if (res.success) {
       console.log(`[FlipIt Simulator] Successfully injected paper trade: ${res.orderId}`);
    }

    // 3. Studio Queue processing (Local Only)
    const studioJobId = await processNextStudioJob();
    if (studioJobId) {
       console.log(`[Studio] Automatically processed queued job: ${studioJobId}`);
    }

    // 4. Autonomous Memory Management (Keep heap clean 24/7)
    const spaceReport = auditSpaceConsumption();
    if (spaceReport.status === "COMPACT_RECOMMENDED") {
      const comp = compactSpaceAndMemory();
      console.log(`[Memory] Auto-compacted heap. Freed ${comp.freedCacheEntries} L1 items. Heap: ${comp.currentHeapUsedMb}MB`);
    }

    // 5. Pre-warm AI context
    prewarmContext();

  } catch (error) {
    console.error(`[Daemon Error]`, error);
  }

  setTimeout(daemonTick, TICK_RATE_MS);
}

// Start the loop
daemonTick();
