// ─────────────────────────────────────────────────────────────
//  S.A.M. · FREE LANES AUTOPILOT — order the free lanes by what will actually answer, and report
//  their state without leaking a single secret.
//
//  ⚠️ BOUNDARY (non-negotiable): nothing here — or anywhere in the autopilot — creates provider
//  accounts, signs up, scrapes or farms API keys, uses temporary emails or phone numbers, or rotates
//  IPs/identities to slip past a per-account limit. "Never run out" is achieved ONLY by (1) staying
//  under each provider's documented free limits (free-quotas.ts + usage-ledger.ts), (2) rotating
//  across keys the OWNER added (KeyPool), (3) failing over across providers and keyless endpoints
//  the router already has, and (4) discovering more free models those same keys already allow
//  (model-discovery.ts). Paid lanes are never reached by this module; tier escalation is unchanged.
//
//  Composition with what existed: lane preference (which brain suits the job) → Colosseum Elo →
//  spread-load → speed.ts healthOrder (sinks the dead and the slow) → quotaOrder below (sinks lanes
//  that cannot answer RIGHT NOW: every key cooling or at 90% of quota, the breaker open, a poor
//  recent success rate, or a nearly spent day). Stable: inside a grade the order chosen upstream wins.
// ─────────────────────────────────────────────────────────────

import { laneAvailability, poolSize } from "./keys.ts";
import { modelDiscoveredAt } from "./model-discovery.ts";
import { laneModel, PROVIDERS, type Provider } from "./model-providers.ts";
import { PROVIDER_REGISTRY } from "./providers.registry.ts";
import { canAttempt } from "./relay.ts";
import { sunk } from "./speed.ts";
import { quotaFor } from "./free-quotas.ts";
import { nearQuota, quotaFreesAt, successRate, usedToday } from "./usage-ledger.ts";

export interface LaneSignals {
  usable: boolean;        // some key (or the keyless endpoint) can be tried right now
  coolingUntil: number;   // when it frees up if not usable (0 = now / unknown)
  headroom: number;       // fraction of today's documented budget left on its best key (1 = unknown)
  successRate: number | null;
  breakerOpen: boolean;
}

export function laneSignals(p: { id: string; noKey?: boolean }, now = Date.now()): LaneSignals {
  const rate = successRate(p.id);
  const breakerOpen = !canAttempt(p.id, now);
  // A noKey lane with a key pooled (hermes) uses the pool; a pure keyless lane uses the "nokey" slot.
  if (p.noKey && poolSize(p.id) === 0) {
    const gated = nearQuota(p.id, "nokey", now);
    return { usable: !gated, coolingUntil: gated ? quotaFreesAt(p.id, "nokey", now) : 0, headroom: 1, successRate: rate, breakerOpen };
  }
  const a = laneAvailability(p.id, now);
  return { usable: a.usable, coolingUntil: a.coolingUntil, headroom: a.headroom, successRate: rate, breakerOpen };
}

/** 0 = try normally · 1 = demote (unreliable lately, or <20% of today's budget left) · 2 = cannot
 *  answer right now (all keys cooling/at quota, or breaker open) — still tried, just last. */
export function laneGrade(s: LaneSignals): 0 | 1 | 2 {
  if (!s.usable || s.breakerOpen) return 2;
  if (s.successRate !== null && s.successRate < 0.5) return 1;
  if (s.headroom < 0.2) return 1;
  return 0;
}

export function quotaOrder<T extends { id: string; noKey?: boolean }>(pool: T[], signals: (p: T) => LaneSignals = (p) => laneSignals(p)): T[] {
  if (pool.length < 2) return pool;
  return pool.map((p, i) => ({ p, i, g: laneGrade(signals(p)) })).sort((a, b) => a.g - b.g || a.i - b.i).map((x) => x.p);
}

// ── GET /api/lanes/status ────────────────────────────────────
export interface LaneStatus {
  id: string;
  name: string;
  healthy: boolean;
  coolingUntil: number;        // epoch ms, 0 when usable now
  usedToday: number;           // requests SAM spent on this lane today (UTC), all keys together
  limitPerDay: number | null;  // the provider's documented free RPD PER KEY; null when unpublished
  model: string;
  discoveredAt: string | null; // last time model discovery refreshed this lane's catalogue
}

const registryLabel = (id: string) => PROVIDER_REGISTRY.find((r) => r.id === id)?.label;

/** Free lanes the router can use right now (a key pooled, or keyless). By construction this emits
 *  NO key values, NO slot ids and NO key counts — the same rule as /api/ai/providers. */
export function lanesStatus(providers: Provider[] = PROVIDERS, now = Date.now()): LaneStatus[] {
  return providers
    .filter((p) => p.tier === "free" && (p.noKey || poolSize(p.id) > 0))
    .map((p) => {
      const s = laneSignals(p, now);
      const label = p.label;
      const model = laneModel(p.id) || (label.includes(":") ? label.slice(label.indexOf(":") + 1) : label);
      return {
        id: p.id,
        name: registryLabel(p.id) ?? (p.id.startsWith("pollinations") ? `Pollinations (${p.id})` : p.id),
        healthy: laneGrade(s) < 2 && !sunk(p.id, now),
        coolingUntil: s.usable ? 0 : s.coolingUntil,
        usedToday: usedToday(p.id, now),
        limitPerDay: quotaFor(p.id)?.rpd ?? null,
        model,
        discoveredAt: modelDiscoveredAt(p.id),
      };
    });
}

// One wallet across the free lanes, split by the job they are actually for.
// A lane can sit in more than one category. The combined total counts each lane once.
export type JobKind = "build" | "pictures" | "video" | "audio" | "research" | "personal";

const BUILD = new Set(["cerebras", "groq", "codestral", "deepseek", "github", "sambanova", "fireworks", "nvidia", "mistral", "huggingface"]);
const RESEARCH = new Set(["perplexity", "cohere", "gemini", "openrouter", "ai21"]);
const PERSONAL = new Set(["hermes"]);

export function jobsFor(id: string, note = ""): JobKind[] {
  const jobs: JobKind[] = [];
  const n = note.toLowerCase();
  if (BUILD.has(id) || /\bcode\b/.test(n)) jobs.push("build");
  // "reads images" is vision (Gemini), not a picture generator. Generators are marked 🎨 or FLUX.
  if (id.startsWith("pollinations") || /🎨|flux/i.test(note)) jobs.push("pictures");
  if (/video|🎬/.test(note)) jobs.push("video");
  if (/audio|voice|speech/.test(n)) jobs.push("audio");
  if (RESEARCH.has(id)) jobs.push("research");
  if (PERSONAL.has(id) || id === "ollama") jobs.push("personal");
  if (!jobs.length) jobs.push("build");
  return jobs;
}

const JOB_LABEL: Record<JobKind, string> = {
  build: "Sites and code",
  pictures: "Pictures",
  video: "Video",
  audio: "Audio",
  research: "Research",
  personal: "On this computer",
};

export function laneWallet(lanes: LaneStatus[], noteOf: (id: string) => string = (id) => PROVIDER_REGISTRY.find((r) => r.id === id)?.note ?? "") {
  const buckets = new Map<JobKind, LaneStatus[]>();
  for (const lane of lanes) {
    for (const job of jobsFor(lane.id, noteOf(lane.id))) {
      const list = buckets.get(job) ?? [];
      list.push(lane);
      buckets.set(job, list);
    }
  }
  const remaining = (lane: LaneStatus) => lane.limitPerDay == null ? null : Math.max(0, lane.limitPerDay - lane.usedToday);
  const tally = (list: LaneStatus[]) => {
    let remainingToday = 0;
    let known = false;
    let unlimited = 0;
    for (const lane of list) {
      if (!lane.healthy) continue;
      const left = remaining(lane);
      if (left == null) unlimited += 1;
      else { remainingToday += left; known = true; }
    }
    return { healthy: list.filter((l) => l.healthy).length, remainingToday: known ? remainingToday : null, unlimited };
  };
  const order: JobKind[] = ["build", "pictures", "video", "audio", "research", "personal"];
  return {
    note: "Remaining free requests today, from the providers' own published limits. Not money. Research is not legal advice.",
    combined: tally(lanes),
    categories: order.filter((id) => buckets.has(id)).map((id) => {
      const list = buckets.get(id)!;
      return { id, label: JOB_LABEL[id], ...tally(list), lanes: list.map((l) => l.name) };
    }),
  };
}
