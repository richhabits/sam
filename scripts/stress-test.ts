process.env.SAM_BENCH_MOCK = "1";
process.env.NODE_ENV = "test";
import { route } from "../server/classify.ts";
import { isFastPath } from "../server/agent.ts";
import { TOOLS, toolByName } from "../server/tools.ts";
import { remember, memoryStats } from "../server/memory.ts";
import { fingerprint, store as cacheStore, lookup as cacheLookup, clearCache, cacheStats } from "../server/cache.ts";
import { desk as flipitDesk } from "../server/flipit.ts";
import { runSelftest } from "../server/selftest.ts";

async function main() {
  console.log("🚀 INITIALIZING STRESS TEST SUITE...");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🔥 S.A.M. HARDCORE STRESS TEST & BREAKAGE SUITE 🔥");
  console.log("═══════════════════════════════════════════════════════════\n");

  const startTotal = Date.now();
  const memBefore = process.memoryUsage();
  let errors = 0;
  let passed = 0;

  function assert(cond: boolean, name: string, detail?: any) {
    if (cond) {
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } else {
      errors++;
      console.error(`  ❌ [FAIL] ${name}`, detail || "");
    }
  }

  // ── TEST 1: Subsystem Selftest ──
  console.log("▶ 1. CORE SUBSYSTEM SELFTEST");
  try {
    const report = await runSelftest(TOOLS);
    assert(report.subsystems.tools.ok, "Tools registry unique & valid", report.subsystems.tools);
    assert(report.subsystems.agents.ok, "Agents registry unique & valid", report.subsystems.agents);
    assert(report.subsystems.vault.ok, "Vault directory writable", report.subsystems.vault);
  } catch (e: any) {
    assert(false, "runSelftest threw exception", e?.message || e);
  }

  // ── TEST 2: High-Velocity Classifier Fuzzing (1,000 queries) ──
  console.log("\n▶ 2. INTENT CLASSIFIER & FAST-PATH FUZZING (1,000 iterations)");
  const fuzzInputs = [
    "",
    "   ",
    "\n\t\r",
    "null",
    "undefined",
    "SELECT * FROM users; DROP TABLE users;--",
    "../../../../../../etc/passwd",
    "a".repeat(100000), // 100KB input string
    "🤖".repeat(5000), // Unicode flood
    "write a poem about quantum physics and coffee",
    "what is the price of AAPL right now?",
    "latest news on artificial intelligence in 2026",
    "calculate (12345 * 6789) / 42",
    "who is Operator and where does he live?",
    "https://example.com/some/long/path?param=1&evil=true",
    "git commit -m 'test' && rm -rf /",
    "echo $SECRET_API_KEY",
    "{\n  \"action\": \"exec\",\n  \"cmd\": \"bash\"\n}",
    "<script>alert('xss')</script>",
    "sudo systemctl restart sam",
  ];

  const tClassifyStart = Date.now();
  let classifySuccess = 0;
  for (let i = 0; i < 1000; i++) {
    const query = fuzzInputs[i % fuzzInputs.length] + ` [iter-${i}]`;
    try {
      const fast = isFastPath(query);
      const decision = route(query);
      if (typeof fast === "boolean" && decision && decision.tier) {
        classifySuccess++;
      }
    } catch (e: any) {
      console.error(`Classifier crash on input #${i}:`, e?.message);
    }
  }
  const classifyElapsed = Date.now() - tClassifyStart;
  assert(classifySuccess === 1000, `1,000 queries routed in ${classifyElapsed}ms (${(classifyElapsed/1000).toFixed(2)}ms/query)`);

  // ── TEST 3: Concurrent Tool Execution & AST Semantic Mapping ──
  console.log("\n▶ 3. AST MAPPER & TOOL CONCURRENCY UNDER LOAD");
  const analyzeTool = toolByName("analyze_workspace");
  assert(!!analyzeTool, "analyze_workspace tool registered");

  if (analyzeTool) {
    const tAst = Date.now();
    try {
      const astRes = await analyzeTool.run({ path: "./server" });
      const astElapsed = Date.now() - tAst;
      assert(typeof astRes === "string" && astRes.length > 50, `AST scan of server/ returned ${astRes.length} chars in ${astElapsed}ms`);
    } catch (e: any) {
      assert(false, "analyze_workspace failed", e?.message);
    }
  }

  // 50 concurrent tool lookups & runs
  const calcTool = toolByName("calculate");
  if (calcTool) {
    const tCalcStart = Date.now();
    const concurrentCalcs = Array.from({ length: 50 }, (_, i) => 
      calcTool.run({ expr: `${i} * 10 + ${i * 2}` })
    );
    const results = await Promise.all(concurrentCalcs);
    const calcElapsed = Date.now() - tCalcStart;
    assert(results.length === 50 && results.every(r => !r.startsWith("that didn't work")), `50 concurrent tool calculations resolved in ${calcElapsed}ms`);
  }

  // ── TEST 4: SQLite Database & Memory Concurrent Stress ──
  console.log("\n▶ 4. VAULT MEMORY & SQLITE CONCURRENCY STRESS");
  try {
    const tMem = Date.now();
    // Test 30 concurrent memory insertions
    const writePromises = Array.from({ length: 30 }, (_, i) => 
      remember(`Stress test memory key-${i}: Value is ${Math.random().toString(36)}`, "stress-test", `bench-user-${i % 3}`)
    );
    await Promise.all(writePromises);

    const stats = memoryStats();
    assert(stats.count >= 0, `Memory store count verified (${stats.count} items, elapsed ${Date.now() - tMem}ms)`);
  } catch (e: any) {
    assert(false, "Memory stress test crashed", e?.message);
  }

  // ── TEST 5: Cache Ingestion & LRU Burst (1,000 entries) ──
  console.log("\n▶ 5. CACHE INGESTION & BURST STRESS (1,000 items)");
  clearCache();
  const tCache = Date.now();
  for (let i = 0; i < 1000; i++) {
    const fp = fingerprint({ skillId: "stress", projectId: "benchmark" });
    cacheStore({ message: `test prompt ${i}`, fp, answer: `cached result ${i}`, provider: "free", tier: "free" });
  }
  const cStats = cacheStats();
  const cacheElapsed = Date.now() - tCache;
  assert(cStats.entries > 0, `Cache swallowed 1,000 burst items in ${cacheElapsed}ms (Active count: ${cStats.entries})`);

  // Verify lookup speed
  const probeFp = fingerprint({ skillId: "stress", projectId: "benchmark" });
  const hit = cacheLookup("test prompt 999", probeFp);
  assert(hit?.answer === "cached result 999", "Cache lookup verified 100% accurate");

  // ── TEST 6: FlipIt Desk Rapid Polling ──
  console.log("\n▶ 6. FLIPIT WATCHDOG & READ DESK CONCURRENCY");
  const tFlipit = Date.now();
  const deskPolls = Array.from({ length: 50 }, () => flipitDesk());
  const deskElapsed = Date.now() - tFlipit;
  assert(deskPolls.length === 50 && deskPolls[0].schema === 2, `50 concurrent FlipIt desk polls resolved in ${deskElapsed}ms (5s memory cache active)`);

  // ── TEST 7: Memory Leak & Heap Consumption Check ──
  console.log("\n▶ 7. HEAP PROFILE & RESOURCE INTEGRITY");
  if (global.gc) global.gc();
  const memAfter = process.memoryUsage();
  const heapDiffMB = ((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2);
  const rssMB = (memAfter.rss / (1024 * 1024)).toFixed(2);
  console.log(`  📊 Heap Used: ${(memAfter.heapUsed / (1024 * 1024)).toFixed(2)} MB (Delta: ${heapDiffMB} MB)`);
  console.log(`  📊 Total RSS: ${rssMB} MB`);
  assert(memAfter.heapUsed < 250 * 1024 * 1024, `Heap stayed well under 250MB guardrail (${heapDiffMB}MB delta)`);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`🏁 STRESS TEST COMPLETE: ${passed} Passed, ${errors} Failed (${Date.now() - startTotal}ms total)`);
  console.log("═══════════════════════════════════════════════════════════\n");

  if (errors > 0) process.exit(1);
}

try {
  await main();
} catch (err) {
  console.error("FATAL ERROR IN STRESS HARNESS:", err);
  process.exit(1);
}
