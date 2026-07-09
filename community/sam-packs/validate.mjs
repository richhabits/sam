#!/usr/bin/env node
// Standalone validator for the community sam-packs repo (no SAM dependency). CI runs this on every
// PR: it checks pack format AND runs the same static safety scan SAM uses on any tool code, so a
// malicious pack is rejected before merge. (SAM ALSO re-scans + sandboxes on import — defence in depth.)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  [/\beval\b/, "eval"], [/\bFunction\s*\(/, "Function ctor"], [/\brequire\b/, "require"],
  [/\bimport\b/, "import"], [/\bprocess\b/, "process"], [/\bglobalThis\b|\bglobal\b/, "global"],
  [/child_process|execSync|\bspawn\b|\bexec\b/, "shell"], [/node:|require\(/, "node builtins"],
  [/__proto__|prototype\s*\[|constructor\s*\[|\.constructor\b/, "proto tampering"],
  [/\bBuffer\b|Atomics|SharedArrayBuffer|WebAssembly/, "low-level"],
  [/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/, "infinite loop"],
  [/XMLHttpRequest|WebSocket/, "raw network"], [/(^|[^.\w])fetch\s*\(/, "ambient fetch"],
];
const CAPS = ["net", "fs:read", "fs:write"];

function scan(code, caps) {
  const v = FORBIDDEN.filter(([re]) => re.test(code)).map(([, w]) => w);
  if (/\bsam\.fetch\b/.test(code) && !caps.includes("net")) v.push("sam.fetch without net");
  if (/\bsam\.writeFile\b/.test(code) && !caps.includes("fs:write")) v.push("sam.writeFile without fs:write");
  if (/\bsam\.readFile\b/.test(code) && !caps.includes("fs:read")) v.push("sam.readFile without fs:read");
  return v;
}

let errors = 0;
const dir = process.argv[2] || "packs";
const files = (() => { try { return readdirSync(dir).filter((f) => f.endsWith(".sampack")); } catch { return []; } })();
if (!files.length) { console.log(`No .sampack files in ${dir}/`); process.exit(0); }

for (const f of files) {
  const path = join(dir, f);
  const fail = (m) => { console.error(`✗ ${f}: ${m}`); errors++; };
  try {
    if (statSync(path).size > 512 * 1024) { fail("pack too large (>512KB)"); continue; }
    const p = JSON.parse(readFileSync(path, "utf8"));
    if (p.format !== "sampack/1") { fail(`bad format ${p.format}`); continue; }
    if (!p.meta?.name || !p.contents) { fail("missing meta.name/contents"); continue; }
    for (const t of p.contents.tools || []) {
      const caps = (t.caps || []).filter((c) => CAPS.includes(c));
      const v = scan(String(t.code || ""), caps);
      if (v.length) fail(`tool "${t.name}" unsafe: ${v.join(", ")}`);
      if (!/^[a-z][a-z0-9_]{2,39}$/.test(t.name || "")) fail(`tool name "${t.name}" invalid`);
    }
    if (!errors) console.log(`✓ ${f} — "${p.meta.name}" (${(p.contents.skills||[]).length} skills, ${(p.contents.tools||[]).length} tools)`);
  } catch (e) { fail(`invalid: ${e.message}`); }
}
if (errors) { console.error(`\n${errors} problem(s) — fix before merge.`); process.exit(1); }
console.log(`\nAll ${files.length} pack(s) valid.`);
