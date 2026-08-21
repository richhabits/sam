// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — LIVE APP SANDBOX DAEMON
//
//  Spawns and monitors Yard scaffolded projects on dynamic local
//  loopback ports, captures runtime logs, and detects crash events
//  for automatic self-healing repair workflows.
// ─────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { parseCompilerDiagnostics, generateRepairPlan, type CodeRepairReport } from "../code-repair.ts";

export interface SandboxAppSession {
  sessionId: string;
  projectId: string;
  cwd: string;
  command: string;
  args: string[];
  port: number;
  pid?: number;
  status: "STARTING" | "RUNNING" | "STOPPED" | "CRASHED";
  startedAt: number;
  stoppedAt?: number;
  exitCode?: number;
  recentLogs: string[];
  crashError?: string;
  repairPlan?: CodeRepairReport;
}

const activeSessions = new Map<string, { session: SandboxAppSession; child?: ChildProcess }>();

/**
 * Finds an open dynamic port on loopback.
 */
export async function findOpenPort(startPort = 4200): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(startPort, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : startPort;
      srv.close(() => resolve(port));
    });
    srv.on("error", () => {
      resolve(findOpenPort(startPort + 1));
    });
  });
}

export function getSandboxSession(sessionId: string): SandboxAppSession | null {
  const entry = activeSessions.get(sessionId);
  return entry ? entry.session : null;
}

export function listSandboxSessions(): SandboxAppSession[] {
  return Array.from(activeSessions.values()).map((e) => e.session);
}

export async function startSandboxApp(input: {
  sessionId?: string;
  projectId: string;
  cwd: string;
  command: string;
  args?: string[];
  port?: number;
}): Promise<SandboxAppSession> {
  const sessionId = input.sessionId || `sandbox-${input.projectId}-${Date.now()}`;
  const port = input.port || (await findOpenPort());
  const args = input.args || [];

  const session: SandboxAppSession = {
    sessionId,
    projectId: input.projectId,
    cwd: input.cwd,
    command: input.command,
    args,
    port,
    status: "STARTING",
    startedAt: Date.now(),
    recentLogs: [],
  };

  try {
    const env = { ...process.env, PORT: String(port) };
    const child = spawn(input.command, args, {
      cwd: input.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    session.pid = child.pid;
    session.status = "RUNNING";

    child.stdout?.on("data", (data) => {
      const text = data.toString("utf8");
      for (const line of text.split("\n")) {
        if (line.trim()) {
          session.recentLogs.push(`[out] ${line}`);
          if (session.recentLogs.length > 300) session.recentLogs.shift();
        }
      }
    });

    child.stderr?.on("data", (data) => {
      const text = data.toString("utf8");
      for (const line of text.split("\n")) {
        if (line.trim()) {
          session.recentLogs.push(`[err] ${line}`);
          if (session.recentLogs.length > 300) session.recentLogs.shift();
        }
      }
    });

    child.on("exit", (code, signal) => {
      session.stoppedAt = Date.now();
      session.exitCode = code ?? (signal ? 1 : 0);
      if (session.status !== "STOPPED") {
        session.status = (code === 0 || signal === "SIGTERM") ? "STOPPED" : "CRASHED";
      }

      if (session.status === "CRASHED") {
        const errorLogs = session.recentLogs.filter((l) => l.startsWith("[err]")).join("\n");
        session.crashError = errorLogs || `Process exited with code ${code}`;
        const diags = parseCompilerDiagnostics(errorLogs);
        if (diags.length > 0) {
          session.repairPlan = generateRepairPlan(diags);
        }
      }
    });

    activeSessions.set(sessionId, { session, child });
    return session;
  } catch (err: any) {
    session.status = "CRASHED";
    session.crashError = err?.message || "Failed to spawn sandbox app process";
    activeSessions.set(sessionId, { session });
    return session;
  }
}

export function stopSandboxApp(sessionId: string): { success: boolean; message: string } {
  const entry = activeSessions.get(sessionId);
  if (!entry) return { success: false, message: `No active sandbox session found with ID "${sessionId}".` };

  entry.session.status = "STOPPED";
  entry.session.stoppedAt = Date.now();

  if (entry.child && !entry.child.killed) {
    try {
      entry.child.kill("SIGTERM");
    } catch { /* already dead */ }
  }

  return { success: true, message: `Sandbox session "${sessionId}" stopped.` };
}
