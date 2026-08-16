// ─────────────────────────────────────────────────────────────
//  S.A.M. · DOCTOR  (v2.1 — "SAM isn't working" → the exact fix)
//  Turns the top support tickets into self-resolution. Each check inspects one common failure mode and,
//  when it's wrong, tells the user precisely what to do. Pure + testable: runDoctor takes the observed
//  "world" (the endpoint gathers it live — brain availability, Ollama reachability, network, vault) so
//  the logic can be unit-tested without a running machine.
// ─────────────────────────────────────────────────────────────

export type Status = "ok" | "warn" | "fail";
export interface DoctorCheck { id: string; label: string; status: Status; detail: string; fix?: string }

export interface DoctorWorld {
  hasCloudKeys: boolean;      // any provider key pooled (free tiers or the user's own)
  ollamaConfigured: boolean;  // an Ollama model is set as the local brain
  ollamaReachable: boolean;   // localhost:11434 answered
  online: boolean;            // the machine can reach the internet
  vaultWritable: boolean;     // SAM can write its data folder
  platform: string;           // process.platform
  ramGb?: number;             // total system RAM in GB — picks a local model that actually fits
}

// Recommend an Ollama model sized to the machine's RAM, so we never tell someone on 8GB to pull a
// model that'll thrash. Pure + testable. Falls back to a safe small model when RAM is unknown.
export function modelForRam(gb?: number): { model: string; note: string } {
  const g = gb && gb > 0 ? Math.round(gb) : 0;
  if (!g)     return { model: "llama3.2:3b", note: "a small, fast model" };
  if (g < 8)  return { model: "llama3.2:3b", note: `~${g}GB RAM → a light 3B model` };
  if (g < 16) return { model: "llama3.1:8b", note: `~${g}GB RAM → a 7–8B model (the sweet spot for tool use)` };
  if (g < 32) return { model: "qwen2.5:14b", note: `~${g}GB RAM → up to a 14B model` };
  return { model: "qwen2.5:32b", note: `~${g}GB RAM → you can run a big 32B+ model` };
}

export function runDoctor(w: DoctorWorld): { healthy: boolean; summary: string; checks: DoctorCheck[] } {
  const checks: DoctorCheck[] = [];
  const hasBrain = w.hasCloudKeys || (w.ollamaConfigured && w.ollamaReachable);
  const rec = modelForRam(w.ramGb);   // RAM-appropriate local model to suggest

  // 1) A brain — the #1 "nothing happens" cause.
  checks.push(hasBrain
    ? { id: "brain", label: "AI brain", status: "ok", detail: w.hasCloudKeys ? "Free cloud brains connected." : "Local Ollama brain responding." }
    : { id: "brain", label: "AI brain", status: "fail", detail: "No AI brain is responding, so SAM can't think.",
        fix: `Fastest: Settings → “Power up (add free keys)” — a 60-second wizard, still free. Or go fully offline: install Ollama (ollama.com), then \`ollama pull ${rec.model}\` — ${rec.note}.` });

  // 2) Ollama specifics — configured but not running is a classic.
  if (w.ollamaConfigured && !w.ollamaReachable) {
    checks.push({ id: "ollama", label: "Local Ollama", status: w.hasCloudKeys ? "warn" : "fail", detail: "Ollama is set as your local brain but isn't responding on localhost:11434.",
      fix: `Start it: open the Ollama app, or run \`ollama serve\` in a terminal, then pull a model — \`ollama pull ${rec.model}\` (${rec.note}).` });
  } else if (w.ollamaConfigured && w.ollamaReachable) {
    checks.push({ id: "ollama", label: "Local Ollama", status: "ok", detail: "Ollama is running and reachable." });
  }

  // 3) Network — offline is fine IF there's a local brain; otherwise it's the problem.
  if (!w.online) {
    checks.push(w.ollamaReachable
      ? { id: "network", label: "Internet", status: "ok", detail: "You're offline — that's fine, SAM is running fully on your local model." }
      : { id: "network", label: "Internet", status: "warn", detail: "You're offline and there's no local model, so cloud brains can't be reached.",
          fix: "Reconnect to the internet, or install Ollama to run SAM completely offline." });
  } else {
    checks.push({ id: "network", label: "Internet", status: "ok", detail: "Online." });
  }

  // 4) Vault writable — if SAM can't persist, memory/settings silently fail.
  checks.push(w.vaultWritable
    ? { id: "vault", label: "Data folder", status: "ok", detail: "SAM can save your data locally." }
    : { id: "vault", label: "Data folder", status: "fail", detail: "SAM can't write to its data folder, so memory and settings won't save.",
        fix: "Check that your user account can write to SAM's vault directory (or free up disk space)." });

  // 5) Accessibility (macOS overlay) — can't be probed headlessly, so it's guidance, not a failure.
  if (w.platform === "darwin") {
    checks.push({ id: "accessibility", label: "⌥Space overlay", status: "warn", detail: "The system-wide ⌥Space overlay needs macOS Accessibility permission (this can't be auto-detected).",
      fix: "If the overlay doesn't appear: System Settings → Privacy & Security → Accessibility → turn SAM on." });
  }

  const healthy = !checks.some((c) => c.status === "fail");
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const summary = healthy
    ? (warns ? `SAM is working. ${warns} thing${warns === 1 ? "" : "s"} to be aware of below.` : "SAM is healthy — everything checks out. ✅")
    : `${fails} thing${fails === 1 ? "" : "s"} to fix before SAM can work. The fix is below each one.`;
  return { healthy, summary, checks };
}

import { sweepStaleLatches } from "./latch.ts";
import { proposeTask } from "./self-heal.ts";
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface HealReport {
  remediated: string[];
  tasksCreated: string[];
  status: "healed" | "needs_attention" | "clean";
  summary: string;
}

/**
 * ── AUTO-HEAL DOCTOR ──
 * Automatically remediates common recoverable issues (stale locks, missing directories)
 * and files admin tasks for unresolvable errors.
 */
export function autoHealDoctor(w: DoctorWorld, vaultDir?: string): HealReport {
  const remediated: string[] = [];
  const tasksCreated: string[] = [];
  const vDir = vaultDir || process.env.VAULT_DIR || join(process.cwd(), "vault");

  // 1. Ensure vault exists and is writable
  try {
    if (!existsSync(vDir)) {
      mkdirSync(vDir, { recursive: true });
      remediated.push(`Created missing vault directory at ${vDir}`);
    }
    const testFile = join(vDir, `.doctor-write-probe-${Date.now()}.tmp`);
    writeFileSync(testFile, "probe", "utf8");
    unlinkSync(testFile);
  } catch (e: any) {
    const task = proposeTask(
      "Vault Permission Failure",
      `SAM cannot write to vault directory (${vDir}): ${e.message}`,
      "bug",
      undefined,
      `Ensure write permissions on ${vDir}`
    );
    tasksCreated.push(task.title);
  }

  // 2. Sweep stale latch locks
  try {
    const cleared = sweepStaleLatches();
    if (cleared.length > 0) {
      remediated.push(`Cleaned ${cleared.length} stale lock(s): ${cleared.join(", ")}`);
    }
  } catch { /* best effort */ }

  // 3. Inspect Doctor status
  const doc = runDoctor(w);
  for (const check of doc.checks) {
    if (check.status === "fail") {
      const task = proposeTask(
        `Doctor Issue: ${check.label}`,
        check.detail,
        "bug",
        undefined,
        check.fix
      );
      tasksCreated.push(task.title);
    }
  }

  const status = tasksCreated.length > 0 ? "needs_attention" : (remediated.length > 0 ? "healed" : "clean");
  const summary = status === "clean"
    ? "System is healthy, no remediation needed."
    : `Auto-heal completed: ${remediated.length} fix(es) applied, ${tasksCreated.length} task(s) logged.`;

  return { remediated, tasksCreated, status, summary };
}

