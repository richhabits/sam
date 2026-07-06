// ─────────────────────────────────────────────────────────────
//  S.A.M. · PROJECT REGISTRY
//  The brands/projects SAM is aware of. Ships with a couple of
//  generic samples. Make SAM yours in one of two ways:
//    • edit the SAMPLE list below, or
//    • drop a `vault/brands.json` (gitignored) with your real
//      brands — SAM loads those and keeps them off GitHub.
//  So your world stays private; the shared code stays clean.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface Project {
  id: string;
  name: string;
  domain?: string;
  status: "live" | "building" | "concept";
  branch: string;            // which skill branch it leans on most
  summary: string;
  tag?: string;              // one-line "what it is" so SAM never mixes brands up
  themeColor?: string;       // HEX color to dynamically reskin SAM's UI
  hooks?: {                  // optional live hooks SAM can reach into
    supabaseProjectId?: string;
    vercelProjectId?: string;
    edgeFunction?: string;
    warRoomUrl?: string;
  };
}

// Shipped generic samples — safe to publish. Replace with your own.
const SAMPLE: Project[] = [
  {
    id: "sample-cafe", name: "Sample Café", domain: "example.com", status: "live", branch: "ops",
    tag: "a local coffee shop", summary: "A sample brand so you can see how SAM uses brand context. Edit or replace me.",
    themeColor: "#10B981" // Emerald green
  },
  {
    id: "sample-store", name: "Sample Store", status: "building", branch: "brand",
    tag: "an online shop", summary: "Another sample. Add your real brands here or in vault/brands.json.",
    themeColor: "#6366F1" // Indigo
  },
];

// Load private brands from a gitignored vault/brands.json if present (your real
// world stays local & unshipped); otherwise fall back to the generic samples.
function loadBrands(): Project[] {
  try {
    const p = join(process.env.VAULT_DIR || join(ROOT, "vault"), "brands.json");
    if (existsSync(p)) {
      const d = JSON.parse(readFileSync(p, "utf8"));
      if (Array.isArray(d) && d.length) return d as Project[];
    }
  } catch { /* fall back to samples */ }
  return SAMPLE;
}

export const PROJECTS: Project[] = loadBrands();

export function projectById(id: string): Project | undefined {
  return PROJECTS.find((p) => p.id === id);
}

// Compact brand list injected into every prompt (kept SHORT to stay under free
// per-minute token limits). Each brand's one-line tag stops SAM confusing them.
// Memoised — PROJECTS is loaded once at startup, so this string is constant.
let _ctx: string | null = null;
export function projectsContext(): string {
  if (_ctx !== null) return _ctx;
  _ctx = !PROJECTS.length ? "" : "Brands (use the right one — don't mix them up):\n" +
    PROJECTS.map((p) => `- ${p.name}${p.domain ? ` (${p.domain})` : ""}${p.tag ? ` — ${p.tag}` : ""}`).join("\n");
  return _ctx;
}
