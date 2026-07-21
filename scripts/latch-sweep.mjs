#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE LATCH SWEEP
//
//  A public repo means the whole world, plus every scraper and model-training crawler,
//  reads the source and its full history. This sweeps for the things that must never be
//  in there: secrets, and personal data.
//
//  Two halves:
//    • SHAPES — postcodes, phones, IBANs, card numbers, key formats. No configuration
//      needed; it finds anything that LOOKS like PII whether or not it is yours.
//    • YOUR LIST — plain strings from local/latch-patterns.txt, which is GITIGNORED.
//      That file is a list of what to look for, so it is itself sensitive and never
//      committed. This runner contains no personal data and is safe to publish.
//
//  It sweeps the FULL git history (every version of every file, across all refs), not
//  just the working tree — history is what a stranger clones, and a secret deleted in a
//  later commit is still right there in an earlier one.
//
//  Usage:  node scripts/latch-sweep.mjs
//  Exit 0 = clean · exit 1 = something to look at.
// ─────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATTERNS = join(ROOT, "local", "latch-patterns.txt");

// The whole patch history as one string: every change ever made. This is what the manual
// sweep proved is the reliable way to search across refs (a bare `git grep <refs>` silently
// returned nothing — the failure that nearly reported a broken probe as "clean").
function fullHistory() {
  try {
    return execFileSync("git", ["-C", ROOT, "log", "--all", "-p", "--no-color"], {
      maxBuffer: 256 * 1024 * 1024, encoding: "utf8",
    });
  } catch (e) {
    console.error("could not read git history:", e?.message || e);
    process.exit(2);
  }
}

// PII shapes. Each is a way personal data looks, independent of whose it is.
const SHAPES = [
  ["your username in a path", /\/Users\/[a-z][a-z0-9._-]+/gi, (m) => !/\/Users\/(x|you|user|alex|a|b|someone|test|name)\b/i.test(m)],
  ["UK postcode", /(?<![A-Za-z0-9/+])[A-Z]{1,2}[0-9][0-9A-Z]? ?[0-9][A-Z]{2}(?![A-Za-z0-9/+])/g,
    (m) => !/^[0-9A-F]{6}$/i.test(m.replace(/ /g, ""))],   // exclude hash/base64 fragments
  ["UK mobile", /\b(?:\+44|0)7[0-9]{9}\b/g],
  ["IBAN", /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b/g],
  ["UK sort code", /\b[0-9]{2}-[0-9]{2}-[0-9]{2}\b/g],
  ["NI number", /\b[A-CEGHJ-PR-TW-Z]{2}[0-9]{6}[A-D]\b/g],
  ["16-digit card", /\b(?:[0-9]{4}[ -]?){3}[0-9]{4}\b/g],
  ["personal email (webmail)", /\b[a-z0-9._%+-]+@(?:gmail|outlook|hotmail|yahoo|icloud|proton)\.[a-z]+\b/gi,
    (m) => !/\b(you|yourname|your\.name|example|sam)@/i.test(m)],
];

// Provider key shapes — a second net under gitleaks, described by prefix only.
const KEYS = [
  ["OpenAI/Anthropic", /\bsk-[a-z0-9_-]{20,}\b/gi],
  ["Groq", /\bgsk_[a-z0-9]{20,}\b/gi],
  ["Vercel", /\bvcp_[a-z0-9]{20,}\b/gi],
  ["Google", /\bAIza[a-z0-9_-]{30,}\b/gi],
  ["GitHub PAT", /\b(?:ghp|github_pat)_[a-z0-9_]{20,}\b/gi],
];

// A hit is only interesting if it is not obviously a placeholder or a test fixture.
const looksSynthetic = (s) =>
  /1234|abcdef|xxxx|placeholder|example|test|fake|deadbeef|redacted|your|SUPERSECRE|WARDEN|canary/i.test(s) ||
  /(.)\1{5,}/.test(s);   // a run of the same character (aaaaaa…) is a fixture, never a real value

function sweep() {
  const hay = fullHistory();
  console.log(`swept the full history — ${hay.split("\n").length.toLocaleString()} lines\n`);
  let findings = 0;

  // control: prove the search actually works before trusting a "clean"
  if (!hay.includes("SAM")) {
    console.error("CONTROL FAILED — the history stream is empty or unsearchable. Not trusting any result.");
    process.exit(2);
  }

  const report = (label, matches, synthetic) => {
    const real = [...new Set(matches)].filter((m) => !synthetic(m));
    if (!real.length) { console.log(`  ✓ ${label}`); return; }
    findings += real.length;
    console.log(`  ⚠ ${label} — ${real.length} to check:`);
    for (const m of real.slice(0, 8)) console.log(`      ${m}`);
  };

  console.log("PII shapes:");
  for (const [label, re, keep] of SHAPES) {
    const ms = (hay.match(re) || []).filter((m) => (keep ? keep(m) : true));
    report(label, ms, looksSynthetic);
  }

  console.log("\nProvider key shapes:");
  for (const [label, re] of KEYS) report(label, hay.match(re) || [], looksSynthetic);

  console.log("\nYour own patterns (local/latch-patterns.txt):");
  if (!existsSync(PATTERNS)) {
    console.log("  — file not found. Create it (gitignored) and add one pattern per line.");
  } else {
    const lines = readFileSync(PATTERNS, "utf8").split("\n")
      .map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (!lines.length) {
      console.log("  — file is present but empty. Add street/name/phone fragments, one per line.");
      console.log("    (Nothing was checked against your specific values — only the shapes above.)");
    } else {
      let any = false;
      for (const pat of lines) {
        // plain case-insensitive substring, not regex — the patterns are literal
        if (hay.toLowerCase().includes(pat.toLowerCase())) {
          console.log(`  ⚠ found: "${pat}"`); findings++; any = true;
        }
      }
      if (!any) console.log(`  ✓ none of your ${lines.length} pattern(s) appear anywhere in history`);
    }
  }

  console.log(`\n${findings ? `⚠ ${findings} thing(s) to look at above.` : "✓ clean — nothing to look at."}`);
  process.exit(findings ? 1 : 0);
}

sweep();
