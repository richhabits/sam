// ─────────────────────────────────────────────────────────────
//  S.A.M. · SAM PACKS  (v1.5 Phase 3 — the growth loop)
//
//  A .sampack is a SIGNED JSON bundle of shareable SAM assets: skills
//  (markdown playbooks), forged tools (code + declared capabilities), prompts,
//  and watched-folder templates. One-tap export from Settings; import shows the
//  user exactly what's inside and runs the FULL forge safety pipeline on any
//  tool — a pack can NEVER auto-install anything. Signing (Ed25519) proves the
//  bundle wasn't tampered in transit and identifies the author key; it does NOT
//  grant trust — the safety pipeline + explicit approval always apply.
// ─────────────────────────────────────────────────────────────

import { generateKeyPairSync, sign as edSign, verify as edVerify, createPublicKey, createPrivateKey } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanCode, testForged, listForged, type Capability, type ForgedTool } from "./forge.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const KEYFILE = join(VAULT_DIR, "pack-signing-key.json");
const SKILLS_DIR = process.env.SAM_SKILLS_DIR || join(__dirname, "..", "skills");   // env-overridable for tests

export const PACK_FORMAT = "sampack/1";

export interface PackSkill { id: string; body: string }             // markdown playbook (safe — no code)
export interface PackTool { name: string; description: string; params: string; explanation: string; code: string; caps: Capability[] }
export interface PackContents {
  skills: PackSkill[];
  tools: PackTool[];
  prompts: { title: string; text: string }[];
  watchedTemplates: { label: string; hint: string }[];   // suggested folders (NEVER auto-added)
}
export interface Pack {
  format: string;
  meta: { name: string; description: string; author: string; createdAt: number };
  contents: PackContents;
  publicKey?: string;   // base64 SPKI der of the author's Ed25519 key
  sig?: string;         // base64 signature over canonical(meta+contents)
}

// Canonical bytes to sign/verify — stable key order, contents + meta only (never the sig/pubkey).
function canonical(p: Pack): Buffer {
  return Buffer.from(JSON.stringify({ format: p.format, meta: p.meta, contents: p.contents }));
}

// ── Per-install signing key (Ed25519). Generated once, stored locally. ──
function loadKeys(): { publicKey: string; privateKey: string } {
  try { if (existsSync(KEYFILE)) return JSON.parse(readFileSync(KEYFILE, "utf8")); } catch { /* regenerate */ }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keys = {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
  try { if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true }); writeFileSync(KEYFILE, JSON.stringify(keys)); } catch { /* ephemeral */ }
  return keys;
}

// ── EXPORT ────────────────────────────────────────────────────
export function exportPack(meta: { name: string; description?: string; author?: string }, contents: PackContents, iso: number): string {
  const pack: Pack = {
    format: PACK_FORMAT,
    meta: { name: meta.name || "Untitled Pack", description: meta.description || "", author: meta.author || "anonymous", createdAt: iso },
    contents: {
      skills: contents.skills || [], tools: contents.tools || [],
      prompts: contents.prompts || [], watchedTemplates: contents.watchedTemplates || [],
    },
  };
  const keys = loadKeys();
  const priv = createPrivateKey({ key: Buffer.from(keys.privateKey, "base64"), type: "pkcs8", format: "der" });
  pack.publicKey = keys.publicKey;
  pack.sig = edSign(null, canonical(pack), priv).toString("base64");
  return JSON.stringify(pack, null, 2);
}

// ── VERIFY (also used by the community-repo CI) ───────────────
export interface VerifyResult { ok: boolean; signed: boolean; sigValid: boolean; reason?: string; pack?: Pack }
export function verifyPack(json: string): VerifyResult {
  let pack: Pack;
  try { pack = JSON.parse(json); } catch { return { ok: false, signed: false, sigValid: false, reason: "not valid JSON" }; }
  if (pack?.format !== PACK_FORMAT) return { ok: false, signed: false, sigValid: false, reason: `unknown format (need ${PACK_FORMAT})` };
  if (!pack.meta?.name || !pack.contents) return { ok: false, signed: false, sigValid: false, reason: "missing meta/contents" };
  const signed = !!(pack.sig && pack.publicKey);
  let sigValid = false;
  if (signed) {
    try {
      const pub = createPublicKey({ key: Buffer.from(pack.publicKey!, "base64"), type: "spki", format: "der" });
      sigValid = edVerify(null, canonical(pack), pub, Buffer.from(pack.sig!, "base64"));
    } catch { sigValid = false; }
  }
  // A pack is structurally OK even if unsigned — the safety pipeline still gates import. But a
  // PRESENT-but-INVALID signature means tampering → reject.
  if (signed && !sigValid) return { ok: false, signed, sigValid, reason: "signature invalid (tampered?)", pack };
  return { ok: true, signed, sigValid, pack };
}

// ── IMPORT (plan) — validate everything, run the forge pipeline on each tool, install NOTHING. ──
export interface ImportPlan {
  ok: boolean; reason?: string;
  meta?: Pack["meta"]; signed?: boolean; sigValid?: boolean;
  skills?: { id: string; exists: boolean }[];
  tools?: { name: string; caps: Capability[]; tier: string; code: string; explanation: string; safe: boolean; violations: string[]; testError?: string; exists: boolean }[];
  prompts?: { title: string; text: string }[];
  watchedTemplates?: { label: string; hint: string }[];
}
export async function planImport(json: string): Promise<ImportPlan> {
  const v = verifyPack(json);
  if (!v.ok || !v.pack) return { ok: false, reason: v.reason };
  const p = v.pack;
  const existingTools = new Set(listForged().map((t) => t.name));
  const tools = [] as NonNullable<ImportPlan["tools"]>;
  for (const t of p.contents.tools || []) {
    const caps = (t.caps || []).filter((c): c is Capability => ["net", "fs:read", "fs:write"].includes(c));
    const scan = scanCode(t.code || "", caps);
    const test = scan.ok ? await testForged(t.code || "", [], caps, t.name) : { ok: false, error: "skipped (failed scan)", samples: [] };
    tools.push({
      name: t.name, caps, tier: caps.some((c) => c === "net" || c === "fs:write") ? "dangerous" : "confirm",
      code: t.code, explanation: t.explanation || t.description || "",
      safe: scan.ok && test.ok, violations: scan.violations, testError: test.ok ? undefined : test.error,
      exists: existingTools.has(t.name),
    });
  }
  return {
    ok: true, meta: p.meta, signed: v.signed, sigValid: v.sigValid,
    skills: (p.contents.skills || []).map((s) => ({ id: s.id, exists: existsSync(join(SKILLS_DIR, s.id, "SKILL.md")) })),
    tools,
    prompts: p.contents.prompts || [],
    watchedTemplates: p.contents.watchedTemplates || [],
  };
}

// ── APPLY — install ONLY what the user approved. Tools land DISABLED (review-then-enable in forge).
// Never auto-adds watched folders; never enables a forged tool. Returns what was installed. ──
export interface ApplyChoice { skills?: string[]; tools?: string[] }
export async function applyPack(json: string, choices: ApplyChoice, iso: number): Promise<{ ok: boolean; installedSkills: string[]; installedTools: string[]; reason?: string }> {
  const v = verifyPack(json);
  if (!v.ok || !v.pack) return { ok: false, installedSkills: [], installedTools: [], reason: v.reason };
  const p = v.pack;
  const wantSkills = new Set(choices.skills || []);
  const wantTools = new Set(choices.tools || []);
  const installedSkills: string[] = [];
  const installedTools: string[] = [];

  for (const s of p.contents.skills || []) {
    if (!wantSkills.has(s.id) || !/^[a-z][a-z0-9_-]{1,39}$/.test(s.id)) continue;   // safe id only
    try { const dir = join(SKILLS_DIR, s.id); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "SKILL.md"), String(s.body || "")); installedSkills.push(s.id); } catch { /* skip */ }
  }
  for (const t of p.contents.tools || []) {
    if (!wantTools.has(t.name)) continue;
    const caps = (t.caps || []).filter((c): c is Capability => ["net", "fs:read", "fs:write"].includes(c));
    if (!scanCode(t.code || "", caps).ok) continue;                 // NEVER install code that fails the scan
    const tier = caps.some((c) => c === "net" || c === "fs:write") ? "dangerous" : "confirm";
    const forged: ForgedTool = {
      name: t.name, code: t.code, caps,
      description: t.description || t.name, params: t.params || "input",
      explanation: t.explanation || "", tests: [], enabled: false,   // DISABLED — user reviews + enables in forge
      createdAt: iso, tier: tier as any,
    };
    try { const dir = join(VAULT_DIR, "forged"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${t.name}.json`), JSON.stringify(forged, null, 2)); installedTools.push(t.name); } catch { /* skip */ }
  }
  return { ok: true, installedSkills, installedTools };
}

// The install's public signing key (so the user can share it / prove authorship).
export function myPackKey(): string { return loadKeys().publicKey; }
