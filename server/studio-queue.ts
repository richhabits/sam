import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, runMigrations, type SqlMigration } from "./db.ts";
import { generateStoryboardDirector } from "./studio-higgsfield.ts";
import { compileProductionTimeline } from "./studio-master-timeline.ts";

const here = dirname(fileURLToPath(import.meta.url));
const vaultPath = process.env.VAULT_DIR || join(here, "..", "vault");
const dbPath = join(vaultPath, "studio-queue.db");

const migrations: SqlMigration[] = [
  {
    version: 1,
    name: "init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS studio_jobs (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          concept TEXT NOT NULL,
          style TEXT,
          result TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    },
  },
];

let dbCache: any = null;
function getDb() {
  if (!dbCache) {
    dbCache = openDb(dbPath);
    runMigrations(dbCache, migrations);
  }
  return dbCache;
}

export function enqueueStudioJob(concept: string, style?: string): string {
  const db = getDb();
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    "INSERT INTO studio_jobs (id, status, concept, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, "pending", concept, style || null, Date.now(), Date.now());
  return id;
}

export function getStudioJob(id: string) {
  return getDb().prepare("SELECT * FROM studio_jobs WHERE id = ?").get(id);
}

export async function processNextStudioJob() {
  const db = getDb();

  // Find a pending job
  const job = db.prepare("SELECT * FROM studio_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").get();
  if (!job) return null; // Queue is empty

  // Conditional claim, not an unconditional UPDATE after the SELECT above: two callers (this
  // was found running as two duplicate daemon processes at once) can both SELECT the same
  // pending row before either UPDATEs. Only the caller whose UPDATE actually matched a still-
  // 'pending' row proceeds — the loser sees changes === 0 and backs off, so a job is never
  // processed twice. Mirrors yard/store.ts's claim().
  const claim = db.prepare("UPDATE studio_jobs SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'pending'").run(Date.now(), job.id);
  if (claim.changes === 0) return null; // another caller claimed it first
  console.log(`[Studio Queue] Processing job ${job.id}: "${job.concept}"`);

  try {
    // Run the actual generation
    const storyboard = await generateStoryboardDirector({
      concept: job.concept,
      style: job.style,
      shotCount: 4,
    });

    // Compile into timeline
    const timeline = compileProductionTimeline({
      conceptPrompt: job.concept,
      sceneCount: storyboard.shots.length,
      aspectRatio: "16:9",
    });

    const result = { storyboard, timeline };

    // Mark completed
    db.prepare("UPDATE studio_jobs SET status = 'completed', result = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(result),
      Date.now(),
      job.id
    );
    console.log(`[Studio Queue] Completed job ${job.id}`);
    
    return job.id;
  } catch (error: any) {
    console.error(`[Studio Queue] Failed job ${job.id}:`, error);
    db.prepare("UPDATE studio_jobs SET status = 'failed', result = ?, updated_at = ? WHERE id = ?").run(
      String(error?.message || error),
      Date.now(),
      job.id
    );
    return null;
  }
}
