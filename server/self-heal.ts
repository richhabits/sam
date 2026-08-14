// ─────────────────────────────────────────────────────────────
//  S.A.M. · SELF-HEALING & ADMIN TASKS
//
//  "If there's a problem you should know what it needs to do and do it and
//  fix it behind the scenes... Or have a list in the admin of stuff that I
//  need to do to put into the code."
// ─────────────────────────────────────────────────────────────

import { join, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const ADMIN_TASKS_FILE = join(VAULT_DIR, "admin_tasks.json");

export interface AdminTask {
  id: string;
  timestamp: string;
  title: string;
  description: string;
  category: "bug" | "feature" | "compliance" | "ui";
  status: "open" | "in_progress" | "resolved";
  suggestedFix?: string;
  stackTrace?: string;
}

export function getAdminTasks(): AdminTask[] {
  if (!existsSync(ADMIN_TASKS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(ADMIN_TASKS_FILE, "utf8")) as AdminTask[];
  } catch {
    return [];
  }
}

function saveAdminTasks(tasks: AdminTask[]) {
  if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true });
  writeFileSync(ADMIN_TASKS_FILE, JSON.stringify(tasks, null, 2));
}

// Propose a task to the admin inbox.
export function proposeTask(
  title: string,
  description: string,
  category: AdminTask["category"],
  stackTrace?: string,
  suggestedFix?: string
): AdminTask {
  const tasks = getAdminTasks();
  const task: AdminTask = {
    id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    title,
    description,
    category,
    status: "open",
    stackTrace,
    suggestedFix,
  };
  tasks.unshift(task);
  saveAdminTasks(tasks);
  return task;
}

export function updateTaskStatus(taskId: string, status: AdminTask["status"]): boolean {
  const tasks = getAdminTasks();
  const task = tasks.find(t => t.id === taskId);
  if (task) {
    task.status = status;
    saveAdminTasks(tasks);
    return true;
  }
  return false;
}

export function analyzeCrashAndProposeTask(kind: string, errorMessage: string, stackTrace?: string) {
  // Simple heuristic for SAM to "know what it needs to do"
  let suggestedFix = "Investigate standard error logs.";
  if (errorMessage.includes("EADDRINUSE")) {
    suggestedFix = "Kill the process occupying the port using `kill -9 $(lsof -t -i:<PORT>)`.";
  } else if (errorMessage.includes("Cannot find module")) {
    suggestedFix = "Run `npm install` for the missing module or verify the import path.";
  } else if (errorMessage.includes("ENOENT")) {
    suggestedFix = "Ensure the target directory/file is created before reading/writing.";
  }

  proposeTask(
    `Auto-Crash Report: ${kind}`,
    `SAM caught an unexpected crash: ${errorMessage}. The system degraded gracefully.`,
    "bug",
    stackTrace,
    suggestedFix
  );
}
