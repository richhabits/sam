#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
//  SAM · validate-packs — the CI gate for the pack ecosystem.
//  Every .sampack in packs/ (or a dir passed as argv[2]) must: parse, have valid structure, and have
//  EVERY forged tool pass the same forge static-scan the app runs on import. Signed packs must verify.
//  Exits 1 on any failure — so a malicious or malformed pack can't merge into the community index.
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { verifyPack } from "../server/packs.ts";
import { scanCode } from "../server/forge.ts";

const dir = process.argv[2] || "packs";
function walk(d: string): string[] {
  let out: string[] = [];
  try {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) out = out.concat(walk(p));
      else if (f.endsWith(".sampack.json") || (extname(f) === ".json" && f.includes("sampack"))) out.push(p);
    }
  } catch { /* dir absent */ }
  return out;
}

const files = walk(dir);
if (!files.length) { console.log(`No packs found under ${dir}/ — nothing to validate.`); process.exit(0); }

let failed = 0;
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const v = verifyPack(raw);
  const problems: string[] = [];
  if (!v.ok) problems.push(`invalid: ${v.reason}`);
  if (v.signed && !v.sigValid) problems.push("signature does not verify");
  for (const t of v.pack?.contents?.tools || []) {
    const scan = scanCode(t.code || "", (t.caps || []) as any);
    if (!scan.ok) problems.push(`tool "${t.name}" fails the safety scan: ${scan.violations.join("; ")}`);
  }
  if (problems.length) { failed++; console.error(`✗ ${file}\n   - ${problems.join("\n   - ")}`); }
  else console.log(`✓ ${file}${v.signed ? " (signed)" : " (unsigned draft — sign on export before publishing)"}`);
}

if (failed) { console.error(`\n${failed} pack(s) failed validation.`); process.exit(1); }
console.log(`\n${files.length} pack(s) valid.`);
