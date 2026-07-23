// ─────────────────────────────────────────────────────────────
//  S.A.M. · ATOMIC FILE WRITE
//
//  SAM's #1 historical failure class is a "successful" write that lost data. A plain
//  writeFileSync truncates the target first, so a crash (or a full disk) mid-write leaves a
//  half-written file — and the NEXT boot reads that truncated JSON, silently dropping every
//  schedule, standing agent, or token the previous good copy held.
//
//  writeFileAtomic writes a sibling temp file and renames it over the target. rename is
//  atomic on POSIX and near-atomic on Windows: a reader sees either the whole old file or
//  the whole new one, never a partial. The temp lives in the SAME directory so the rename
//  stays on one filesystem (a cross-device rename is a copy, which is not atomic).
//
//  `mode` sets the file's permissions — pass 0o600 for anything holding a secret, so the
//  file is not world-readable on a shared machine even after the contents are redacted.
// ─────────────────────────────────────────────────────────────

import { writeFileSync, renameSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname, join, basename } from "node:path";

let seq = 0;

export function writeFileAtomic(target: string, data: string | Buffer, opts: { mode?: number } = {}): void {
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Unique per process + call so two writers in one process never collide on the temp name.
  const tmp = join(dir, `.${basename(target)}.${process.pid}.${seq++}.tmp`);
  writeFileSync(tmp, data, opts.mode !== undefined ? { mode: opts.mode } : undefined);
  // renameSync does not re-apply mode on some platforms if the target pre-existed with a
  // different mode; set it explicitly so a secret file cannot inherit a looser permission.
  if (opts.mode !== undefined) { try { chmodSync(tmp, opts.mode); } catch { /* best-effort on platforms without chmod */ } }
  renameSync(tmp, target);
}
