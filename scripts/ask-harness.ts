// ─────────────────────────────────────────────────────────────
//  THE ASK — live harness. Watch the scheduler bug get fixed.
//
//  A scheduled task decided to send an email (a DANGEROUS action) with no one in-session. Today the
//  scheduler reports "Finished." and the action is lost. With SAM_ASK on, it's DEFERRED and surfaced
//  instead — nothing performed.
//
//  Run it:   npx tsx scripts/ask-harness.ts
//  (Writes only to a throwaway temp vault — your real vault is untouched.)
// ─────────────────────────────────────────────────────────────
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.VAULT_DIR = mkdtempSync(join(tmpdir(), "sam-ask-harness-"));   // don't touch the real vault

const { handleUnattended, openAsks, _clearAsks } = await import("../server/ask.ts");

// What a scheduled agent run hands back when it wants to send an email but no one can approve it.
const pending = {
  kind: "pending", tool: "send_email",
  input: { to: "boss@acme.com", subject: "The report" },
  activity: "email your boss the report", transcript: "", trace: [],
};

function show(label: string): void {
  const out = handleUnattended(pending, {
    tier: "free", source: "scheduler",
    why: 'a scheduled task ("email boss the report") needs this to continue',
  });
  // This is exactly what the scheduler callback now returns (index.ts):
  const schedulerReturns = out.kind !== "none" ? out.text : "Finished.";
  console.log(`\n── ${label} ──`);
  console.log(`  scheduler returns → ${JSON.stringify(schedulerReturns)}`);
  console.log(`  Asks awaiting your OK → ${openAsks().length}`);
  for (const a of openAsks()) {
    console.log(`     • “${a.action}” · ${a.blast} · from ${a.source} — approve, or it's DEFERRED (not done)`);
  }
}

_clearAsks(); delete process.env.SAM_ASK;
show("SAM_ASK OFF  (the bug: reported as SUCCESS, the action silently lost)");

_clearAsks(); process.env.SAM_ASK = "1";
show("SAM_ASK ON   (the fix: DEFERRED + surfaced, nothing performed)");

console.log("\nWith the flag on, that Ask also shows in the Console (GET /api/console) and, once a");
console.log("channel is configured, arrives as a push / native notification / email — all your own.\n");
