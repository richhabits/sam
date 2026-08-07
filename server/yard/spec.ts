// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — the spec
//
//  One sentence in, a plan you can read and argue with out. The build loop already
//  exists; what it lacked was anything between "build me a booking site" and files
//  appearing on disk. A build that starts from a sentence has to guess at everything,
//  and every guess it gets wrong is discovered several minutes later, in the output.
//
//  So: a structured spec first, shown before anything is written. Three properties
//  matter more than its contents.
//
//  It is CHEAP. A plan is a small piece of JSON, so it goes to the free tier and is
//  asked for in one call. Nothing about planning should cost what building costs.
//
//  It NEVER hard-depends on the model. If the call fails, returns prose, or returns
//  JSON with the wrong shape, a deterministic plan is derived from the request instead
//  and the spec says so. A planner that can fail closed would make the whole builder
//  unavailable whenever a free provider is having a bad afternoon.
//
//  It is HONEST about what "app" means here. The word means a web app or an
//  installable PWA — a native App Store binary is the pocket's job, not this one.
//  That sentence is carried in the spec itself rather than left in documentation,
//  because the person reading the plan is the person who needs to know.
// ─────────────────────────────────────────────────────────────

import { runModel, type Tier } from "../models.ts";

// What is being made. The distinction drives the stack, so it is a closed set rather
// than free text — an unknown kind cannot be given defaults.
export type ProjectKind = "website" | "webapp" | "api" | "pwa";
export const KINDS: ProjectKind[] = ["website", "webapp", "api", "pwa"];

export interface Stack {
  frontend: string | null;
  backend: string | null;
  data: string | null;
  host: string;               // where a deploy would go, named so the plan can be argued with
}

export interface SpecPage { name: string; purpose: string }
export interface SpecModel { name: string; fields: string[] }

export interface BuildSpec {
  kind: ProjectKind;
  name: string;
  summary: string;            // one sentence, the thing itself rather than the request
  pages: SpecPage[];          // screens for an app, pages for a site; empty for an api
  models: SpecModel[];        // the data model, empty when nothing is stored
  features: string[];
  stack: Stack;
  brand: string | null;       // a preset name, resolved by the brand layer, not here
  note: string;               // the honest constraint, always present
  derived: boolean;           // true when this came from the fallback, not the model
}

// The constraint stated in every spec. "App" is the word people use for all of it, and
// leaving the ambiguity in the plan is how someone ends up expecting a binary.
export const APP_NOTE =
  "\"App\" here means a web app or an installable PWA, built and deployed to your own " +
  "infrastructure. A native App Store binary is a separate job and is not what this builds.";

// Default stacks, matched to infrastructure that already exists rather than to fashion.
// Named so a plan can be disagreed with before it costs anything to change.
export const DEFAULT_STACKS: Record<ProjectKind, Stack> = {
  website: { frontend: "React + Vite + Tailwind", backend: null, data: null, host: "Vercel" },
  webapp:  { frontend: "React + Vite + Tailwind", backend: "Express + TypeScript", data: "Neon + Drizzle", host: "Vercel" },
  api:     { frontend: null, backend: "Express + TypeScript", data: "Neon + Drizzle", host: "Railway" },
  pwa:     { frontend: "React + Vite + Tailwind (PWA)", backend: null, data: null, host: "Vercel" },
};

// Auth or file storage is the one thing that changes the data default: it is the case
// where rolling your own is the expensive choice.
const NEEDS_PLATFORM = /\b(sign[- ]?in|sign[- ]?up|log[- ]?in|login|auth|account|accounts|user accounts|upload|uploads|file storage|avatar)\b/i;

// Reading the kind from the request. Deliberately rules, for the same reason `intent.ts`
// is rules: every branch here can be read and argued with.
const API_ONLY = /\b(api|endpoint|endpoints|webhook|webhooks|rest service|backend service)\b/i;
const APPY = /\b(app|web app|webapp|dashboard|portal|admin|tool|calculator|tracker|crm|booking system)\b/i;
const INSTALLABLE = /\b(pwa|installable|offline|home screen|phone app|mobile app)\b/i;

export function kindFrom(request: string): ProjectKind {
  const t = String(request || "");
  if (INSTALLABLE.test(t)) return "pwa";
  if (API_ONLY.test(t) && !APPY.test(t)) return "api";
  if (APPY.test(t)) return "webapp";
  return "website";
}

export function stackFor(kind: ProjectKind, request = ""): Stack {
  const base = { ...DEFAULT_STACKS[kind] };
  if (NEEDS_PLATFORM.test(request) && kind !== "website") base.data = "Supabase (auth + storage)";
  return base;
}

// ── The deterministic plan ──────────────────────────────────────────────────
// What the spec is when the model cannot be reached, and the floor the model's answer
// is merged onto. Never empty, never a guess dressed as a certainty: a website gets the
// pages every small site actually has, and nothing invents a data model it wasn't told
// about.

const DEFAULT_PAGES: Record<ProjectKind, SpecPage[]> = {
  website: [
    { name: "Home", purpose: "what this is, and the one thing to do next" },
    { name: "About", purpose: "who is behind it" },
    { name: "Contact", purpose: "how to get in touch" },
  ],
  webapp: [
    { name: "Home", purpose: "the way in" },
    { name: "Dashboard", purpose: "the main working screen" },
  ],
  pwa: [{ name: "Home", purpose: "the main screen, installable to the home screen" }],
  api: [],
};

export function fallbackSpec(request: string, name: string): BuildSpec {
  const kind = kindFrom(request);
  return {
    kind,
    name,
    summary: String(request || name).replace(/\s+/g, " ").trim().slice(0, 200),
    pages: DEFAULT_PAGES[kind].map((p) => ({ ...p })),
    models: [],
    features: [],
    stack: stackFor(kind, request),
    brand: null,
    note: APP_NOTE,
    derived: true,
  };
}

// ── Validation ──────────────────────────────────────────────────────────────
// A model's JSON is untrusted input. Every field is taken only if it is the right shape,
// and anything missing falls back rather than failing — a plan with three good sections
// and one absent one is still worth showing.

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

const strList = (v: unknown, max: number, cap: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter((x): x is string => !!x).slice(0, cap) : [];

function pagesFrom(v: unknown): SpecPage[] {
  if (!Array.isArray(v)) return [];
  const out: SpecPage[] = [];
  for (const p of v.slice(0, 12)) {
    const name = str(typeof p === "string" ? p : (p as any)?.name, 40);
    if (!name) continue;
    out.push({ name, purpose: str((p as any)?.purpose, 120) ?? "" });
  }
  return out;
}

function modelsFrom(v: unknown): SpecModel[] {
  if (!Array.isArray(v)) return [];
  const out: SpecModel[] = [];
  for (const m of v.slice(0, 8)) {
    const name = str((m as any)?.name, 40);
    if (!name) continue;
    out.push({ name, fields: strList((m as any)?.fields, 40, 16) });
  }
  return out;
}

// Merge what the model returned onto the deterministic floor. The floor's stack wins
// unless the model named something for that slot: the defaults exist because they match
// infrastructure that is already paid for, and a model's opinion is not a reason to
// deploy somewhere nobody has an account.
export function normaliseSpec(raw: unknown, request: string, name: string): BuildSpec {
  const base = fallbackSpec(request, name);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;

  const kind = KINDS.includes(o.kind as ProjectKind) ? (o.kind as ProjectKind) : base.kind;
  const stack = stackFor(kind, request);
  const pages = pagesFrom(o.pages);
  const rawStack = (o.stack && typeof o.stack === "object" ? o.stack : {}) as Record<string, unknown>;

  return {
    kind,
    name: str(o.name, 60) ?? base.name,
    summary: str(o.summary, 200) ?? base.summary,
    pages: pages.length ? pages : (kind === base.kind ? base.pages : DEFAULT_PAGES[kind].map((p) => ({ ...p }))),
    models: modelsFrom(o.models),
    features: strList(o.features, 90, 12),
    stack: {
      frontend: str(rawStack.frontend, 60) ?? stack.frontend,
      backend: str(rawStack.backend, 60) ?? stack.backend,
      data: str(rawStack.data, 60) ?? stack.data,
      host: str(rawStack.host, 40) ?? stack.host,
    },
    brand: str(o.brand, 40),
    note: APP_NOTE,
    derived: false,
  };
}

// ── Asking for one ──────────────────────────────────────────────────────────

const SYSTEM =
  "You plan small web builds. Return ONE JSON object and nothing else — no prose, no code fence.\n" +
  "Shape: {kind, name, summary, pages:[{name,purpose}], models:[{name,fields:[string]}], features:[string], brand}\n" +
  "kind is one of: website, webapp, api, pwa.\n" +
  "summary is one sentence describing the thing itself, not the request.\n" +
  "pages are the actual screens a person would use. models only if something must be stored — otherwise [].\n" +
  "features are concrete and few. brand is a brand name if the request names one, else null.\n" +
  "Do not choose a technology stack; that is decided elsewhere.";

// The Grammar for a plan. Passed as Ollama's `format`, which constrains a local model to
// emit this shape rather than hoping it obeys the prose. Cloud lanes ignore it (see
// runModelInner — `format` reaches the local lane only), so it costs them nothing.
//
// The first version of this passed `{type:"json_object"}` — the other vendor's shape.
// Ollama rejected it, the local lane retried unconstrained, and the model answered in
// prose, so every local plan silently came back derived. It looked exactly like "the
// planner is unavailable" and was in fact "the planner was asked in the wrong dialect".
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: KINDS },
    name: { type: "string" },
    summary: { type: "string" },
    pages: { type: "array", items: { type: "object", properties: { name: { type: "string" }, purpose: { type: "string" } }, required: ["name"] } },
    models: { type: "array", items: { type: "object", properties: { name: { type: "string" }, fields: { type: "array", items: { type: "string" } } }, required: ["name"] } },
    features: { type: "array", items: { type: "string" } },
    brand: { type: ["string", "null"] },
  },
  required: ["kind", "name", "summary", "pages"],
} as const;

export interface SpecOptions { tier?: Tier; now?: number }

// One call, free tier by default. Any failure — network, prose instead of JSON, JSON of
// the wrong shape — lands on the deterministic plan, marked `derived` so the surface can
// say the planner was unavailable rather than quietly showing a thinner plan as if it
// were the model's considered answer.
export async function buildSpec(request: string, name: string, opts: SpecOptions = {}): Promise<BuildSpec> {
  // Free tier by default, and the configured default when there is one — the same
  // pattern the playbook handler uses. It matters here beyond consistency: it is what
  // lets planning run entirely offline against a local model, which is the difference
  // between "cheap" and "costs nothing at all".
  const tier: Tier = opts.tier ?? ((process.env.DEFAULT_TIER as Tier) || "free");
  const prompt = String(request || name).slice(0, 2_000);
  try {
    const r = await runModel(tier, SYSTEM, prompt, undefined, { reason: "yard: planning a build", format: PLAN_SCHEMA });
    const match = String(r.text || "").match(/\{[\s\S]*\}/);
    if (!match) return fallbackSpec(request, name);
    return normaliseSpec(JSON.parse(match[0]), request, name);
  } catch {
    return fallbackSpec(request, name);
  }
}

// ── Showing one ─────────────────────────────────────────────────────────────
// The plan as a person reads it. Markdown because that is what both the chat surface and
// the glass already render, so one rendering serves both rather than each growing its own.

export function specSummary(spec: BuildSpec): string {
  const lines: string[] = [`**${spec.name}** — ${spec.summary}`, ""];
  lines.push(`· **Kind** — ${spec.kind}`);

  const stack = [
    spec.stack.frontend && `front end ${spec.stack.frontend}`,
    spec.stack.backend && `back end ${spec.stack.backend}`,
    spec.stack.data && `data ${spec.stack.data}`,
    `deploys to ${spec.stack.host}`,
  ].filter(Boolean).join(" · ");
  lines.push(`· **Stack** — ${stack}`);

  if (spec.pages.length) {
    lines.push(`· **${spec.kind === "webapp" || spec.kind === "pwa" ? "Screens" : "Pages"}** — ${spec.pages.map((p) => p.name).join(", ")}`);
  }
  if (spec.models.length) {
    lines.push(`· **Data** — ${spec.models.map((m) => `${m.name} (${m.fields.join(", ")})`).join(" · ")}`);
  }
  if (spec.features.length) lines.push(`· **Features** — ${spec.features.join(" · ")}`);
  if (spec.brand) lines.push(`· **Brand** — ${spec.brand}`);

  lines.push("");
  if (spec.derived) {
    lines.push("_The planner was unavailable, so this plan was derived from your request rather than reasoned about. Worth a read before you confirm._");
  }
  lines.push(`_${spec.note}_`);
  return lines.join("\n");
}
