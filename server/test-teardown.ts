// Vitest globalSetup: named setup + teardown. teardown() runs ONCE in the main process
// after the whole run, pass or fail. Per-worker exit handlers can't be relied on — vitest
// kills its forked workers rather than letting them exit — so cleanup lives here.
//
// The workers each make their own sam-test-* dirs (see test-setup.ts) and cannot know when
// the run as a whole is done. This sweeps ALL of them from the OS temp dir at the end, by
// their shared prefix, so nothing accumulates however a worker met its end.
import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function setup() { /* nothing to prepare; the work is in teardown */ }

export function teardown() {
  const tmp = tmpdir();
  let removed = 0;
  try {
    for (const name of readdirSync(tmp)) {
      if (!name.startsWith("sam-test-")) continue;
      const p = join(tmp, name);
      try { if (statSync(p).isDirectory()) { rmSync(p, { recursive: true, force: true }); removed++; } }
      catch { /* vanished mid-sweep — the desired end state */ }
    }
  } catch { /* no temp dir? nothing to do */ }
  if (removed) process.stderr.write(`\n  cleaned ${removed} test temp dir(s)\n`);
}
