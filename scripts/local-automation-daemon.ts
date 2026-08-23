import { checkFlipItAlerts } from "../server/flipit.ts";
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

    // 2. Real Market Alerts (Polymarket CLOB)
    // Removed local simulator: Daemon only runs live data pipelines.


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
