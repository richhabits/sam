// ─────────────────────────────────────────────────────────────
//  S.A.M. · OPENAI-COMPATIBLE GATEWAY — one local front for every free model SAM can call.
//
//  The list is built from lanes SAM already has, not from a target count:
//    · each free registry lane's chat model (the slug that lane actually sends)
//    · model-discovery catalogues (openrouter :free, groq, cerebras, mistral, nvidia, gemini)
//    · a public OpenRouter list refresh, same zero-price :free filter discovery uses
//    · Pollinations' anonymous text list (one model the last time it was read — aliases are
//      the same model, not extra rows)
//    · image / video / audio model ids that server/tools.ts already posts, unchanged
//
//  Nothing here adds a provider, a paid host, or a model id that those sources do not name.
//  Strength tags are text / vision / images / video / audio. A text model is not labelled legal.
//  Research in the wallet is not legal advice. Chat completions refuse a lane with no key and
//  no keyless path instead of answering as if it had worked.
// ─────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import { poolSize, getKey, reportFailure, reportSuccess } from "./keys.ts";
import { estTokens } from "./metrics.ts";
import { catalogue, SOURCES, type Catalogue } from "./model-discovery.ts";
import { callFreeChat, PROVIDERS, streamFreeChat, type Provider } from "./model-providers.ts";
import { runModel } from "./models.ts";
import { PROVIDER_REGISTRY, type ProviderSpec } from "./providers.registry.ts";
import { relayBrain } from "./relay.ts";
import { recordLaneCall, slotId } from "./usage-ledger.ts";

export type Strength = "text" | "vision" | "images" | "video" | "audio";

/** Model ids SAM's image/video/audio code already sends. Not chat models.
 *  Leonardo's generations call names no model id, so it is not given one here. */
export const DOCUMENTED_MEDIA: { provider: string; model: string; strengths: Strength[] }[] = [
  { provider: "together", model: "black-forest-labs/FLUX.1-schnell-Free", strengths: ["images"] },
  { provider: "huggingface", model: "black-forest-labs/FLUX.1-schnell", strengths: ["images"] },
  { provider: "nvidia", model: "black-forest-labs/flux.1-schnell", strengths: ["images"] },
  { provider: "deepinfra", model: "black-forest-labs/FLUX-1-schnell", strengths: ["images"] },
  { provider: "fal", model: "fal-ai/flux/schnell", strengths: ["images"] },
  { provider: "siliconflow", model: "Kwai-Kolors/Kolors", strengths: ["images"] },
  { provider: "siliconflow", model: "Wan-AI/Wan2.1-T2V-14B-Turbo", strengths: ["video"] },
  { provider: "fal", model: "alibaba/happy-horse/v1.1/text-to-video", strengths: ["video", "audio"] },
  { provider: "novita", model: "darkSushiMixMix_225D_46414.safetensors", strengths: ["video"] },
  { provider: "groq", model: "whisper-large-v3", strengths: ["audio"] },
];

export interface GatewayModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  sam: {
    provider: string;
    upstream: string;
    strengths: Strength[];
    callable: boolean;
    /** Other names for this same model. Not separate rows. */
    aliases?: string[];
  };
}

export interface GatewayList {
  object: "list";
  data: GatewayModel[];
}

interface ChatLaneInput {
  id: string;
  note: string;
  models: string[];
  callable: boolean;
  created: number;
}

interface PolModel {
  name: string;
  aliases?: string[];
  tier?: string;
  vision?: boolean;
  audio?: boolean;
  input_modalities?: string[];
  output_modalities?: string[];
}

export interface GatewayInputs {
  chat: ChatLaneInput[];
  media: { provider: string; model: string; strengths: Strength[]; callable: boolean }[];
  pollinations: PolModel[];
  pollinationsCallable: boolean;
}

const STRENGTH_ORDER: Strength[] = ["text", "vision", "images", "video", "audio"];

export function chatStrengths(note: string): Strength[] {
  const s: Strength[] = ["text"];
  // Gemini's registry note is the vision lane. Image/video notes belong to the media ids below,
  // not to that provider's chat slug — a Llama chat model does not become an image model.
  if (/vision|photos|👁/u.test(note)) s.push("vision");
  return s;
}

export function parsePollinations(body: unknown): PolModel[] {
  if (!Array.isArray(body)) return [];
  const out: PolModel[] = [];
  for (const raw of body) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as PolModel;
    if (typeof m.name !== "string" || !m.name.trim()) continue;
    // The public list mixes tiers. Only the anonymous (no-key) tier is a free lane.
    if (typeof m.tier === "string" && m.tier !== "anonymous") continue;
    const aliases = Array.isArray(m.aliases) ? m.aliases.filter((a): a is string => typeof a === "string" && a !== m.name) : [];
    out.push({
      name: m.name.trim(),
      aliases,
      tier: m.tier,
      vision: m.vision === true,
      audio: m.audio === true,
      input_modalities: Array.isArray(m.input_modalities) ? m.input_modalities.filter((x): x is string => typeof x === "string") : [],
      output_modalities: Array.isArray(m.output_modalities) ? m.output_modalities.filter((x): x is string => typeof x === "string") : [],
    });
  }
  return out;
}

function polStrengths(m: PolModel): Strength[] {
  const s = new Set<Strength>();
  const inn = m.input_modalities ?? [];
  const out = m.output_modalities ?? [];
  if (out.includes("text") || inn.includes("text") || (!out.length && !inn.length)) s.add("text");
  if (m.vision || inn.includes("image")) s.add("vision");
  if (out.includes("image")) s.add("images");
  if (m.audio || out.includes("audio") || inn.includes("audio")) s.add("audio");
  if (out.includes("video")) s.add("video");
  return STRENGTH_ORDER.filter((x) => s.has(x));
}

function unix(iso?: string | null): number {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? Math.floor(n / 1000) : 0;
}

function upstreamFromLabel(label: string): string {
  const idx = label.indexOf(":");
  if (idx >= 0) {
    const rest = label.slice(idx + 1).trim();
    // pollinations:get is a second URL, not a model id.
    if (!rest || rest === "get") return "";
    return rest;
  }
  return label.trim();
}

export function assembleGatewayInputs(deps: {
  registry?: ProviderSpec[];
  providers?: Pick<Provider, "id" | "tier" | "label" | "noKey">[];
  cat?: Catalogue;
  hasKey?: (id: string) => boolean;
  pollinations?: PolModel[] | null;
  extraOpenRouter?: string[];
} = {}): GatewayInputs {
  const registry = deps.registry ?? PROVIDER_REGISTRY;
  const providers = deps.providers ?? PROVIDERS;
  const cat = deps.cat ?? catalogue();
  const hasKey = deps.hasKey ?? ((id: string) => poolSize(id) > 0);
  const free = new Map(registry.filter((r) => r.tier === "free").map((r) => [r.id, r]));
  const chat: ChatLaneInput[] = [];
  for (const p of providers) {
    if (p.tier !== "free") continue;
    if (p.id.startsWith("pollinations")) continue;
    const spec = free.get(p.id);
    // A runtime lane with no registry row is only included when it is keyless (Pollinations).
    // Premium registry rows (Moonshot, OpenAI, Anthropic) never become free gateway models.
    if (!spec) continue;
    const listed = cat.providers[p.id]?.models?.filter((m) => typeof m === "string" && m.trim()) ?? [];
    const extra = p.id === "openrouter" ? (deps.extraOpenRouter ?? []) : [];
    const fallback = upstreamFromLabel(p.label);
    const models = [...new Set([...listed, ...extra, ...(fallback ? [fallback] : [])])].filter((m) => !DOCUMENTED_MEDIA.some((d) => d.provider === p.id && d.model === m));
    if (!models.length) continue;
    chat.push({
      id: p.id,
      note: spec.note,
      models,
      callable: !!(p.noKey || hasKey(p.id)),
      created: unix(cat.providers[p.id]?.discoveredAt),
    });
  }
  const media = DOCUMENTED_MEDIA.filter((m) => free.has(m.provider)).map((m) => ({
    ...m,
    callable: hasKey(m.provider),
  }));
  // null means the public list could not be fetched: keep the one anonymous model the lane calls.
  const pollinations = deps.pollinations === undefined || deps.pollinations === null
    ? [{ name: "openai-fast", aliases: ["openai", "gpt-oss", "gpt-oss-20b", "ovh-reasoning"], tier: "anonymous", input_modalities: ["text"], output_modalities: ["text"], vision: false, audio: false }]
    : deps.pollinations;
  return { chat, media, pollinations, pollinationsCallable: true };
}

export function buildGatewayModels(inputs: GatewayInputs): GatewayModel[] {
  const byId = new Map<string, GatewayModel>();
  const put = (row: GatewayModel) => {
    const prev = byId.get(row.id);
    if (!prev) { byId.set(row.id, row); return; }
    const strengths = STRENGTH_ORDER.filter((s) => prev.sam.strengths.includes(s) || row.sam.strengths.includes(s));
    const aliases = [...new Set([...(prev.sam.aliases ?? []), ...(row.sam.aliases ?? [])])];
    prev.sam = { ...prev.sam, strengths, callable: prev.sam.callable || row.sam.callable, aliases: aliases.length ? aliases : undefined };
  };
  for (const lane of inputs.chat) {
    const strengths = chatStrengths(lane.note);
    for (const model of lane.models) {
      put({
        id: `${lane.id}/${model}`,
        object: "model",
        created: lane.created,
        owned_by: lane.id,
        sam: { provider: lane.id, upstream: model, strengths, callable: lane.callable },
      });
    }
  }
  for (const m of inputs.media) {
    put({
      id: `${m.provider}/${m.model}`,
      object: "model",
      created: 0,
      owned_by: m.provider,
      sam: { provider: m.provider, upstream: m.model, strengths: [...m.strengths], callable: m.callable },
    });
  }
  for (const m of parsePollinations(inputs.pollinations)) {
    put({
      id: `pollinations/${m.name}`,
      object: "model",
      created: 0,
      owned_by: "pollinations",
      sam: {
        provider: "pollinations",
        upstream: m.name,
        strengths: polStrengths(m),
        callable: inputs.pollinationsCallable,
        aliases: m.aliases?.length ? m.aliases : undefined,
      },
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

let listCache: { at: number; body: GatewayList } | null = null;
export function _resetGatewayListCache(): void { listCache = null; }

async function fetchJson(url: string, f: typeof fetch): Promise<unknown> {
  const r = await f(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json();
}

export async function gatewayModelList(opts: { fetch?: typeof fetch; now?: number; force?: boolean } = {}): Promise<GatewayList> {
  const now = opts.now ?? Date.now();
  if (!opts.force && !opts.fetch && listCache && now - listCache.at < 10 * 60_000) return listCache.body;
  const f = opts.fetch ?? fetch;
  const orSource = SOURCES.find((s) => s.id === "openrouter");
  let extraOpenRouter: string[] = [];
  let pollinations: PolModel[] | null = null;
  const [orRes, polRes] = await Promise.allSettled([
    fetchJson("https://openrouter.ai/api/v1/models", f),
    fetchJson("https://text.pollinations.ai/models", f),
  ]);
  if (orRes.status === "fulfilled" && orSource) {
    try { extraOpenRouter = orSource.parse(orRes.value); } catch { extraOpenRouter = []; }
  }
  if (polRes.status === "fulfilled") pollinations = parsePollinations(polRes.value);
  const data = buildGatewayModels(assembleGatewayInputs({ extraOpenRouter, pollinations }));
  const body: GatewayList = { object: "list", data };
  if (!opts.fetch) listCache = { at: now, body };
  return body;
}

export function openAIError(message: string, type = "invalid_request_error", code: string | null = null) {
  return { error: { message, type, code } };
}

type Wire = { role: string; content: string };

export function flattenChat(messages: unknown): { system: string; prompt: string; wire: Wire[] } | { error: string } {
  if (!Array.isArray(messages) || messages.length === 0) return { error: "messages is required" };
  const systemParts: string[] = [];
  const wire: Wire[] = [];
  let sawUser = false;
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") return { error: "each message needs a role and text content" };
    const role = String((raw as { role?: unknown }).role ?? "");
    if (!["system", "user", "assistant", "tool", "developer"].includes(role)) return { error: `unsupported role ${role}` };
    const content = (raw as { content?: unknown }).content;
    const text = contentToText(content);
    if (text === null) return { error: "message content must be text" };
    if (text === "image") return { error: "this gateway forwards text only — an image part would not be shown to the model" };
    if (role === "system" || role === "developer") systemParts.push(text);
    else {
      if (role === "user") sawUser = true;
      wire.push({ role: role === "tool" ? "user" : role, content: role === "tool" ? `Tool result:\n${text}` : text });
    }
  }
  if (!sawUser) return { error: "messages must include a user message" };
  const system = systemParts.join("\n\n");
  const full: Wire[] = [...(system ? [{ role: "system", content: system }] : []), ...wire];
  const prompt = wire.map((m) => (m.role === "user" ? m.content : `${m.role}: ${m.content}`)).join("\n\n");
  return { system, prompt, wire: full };
}

function contentToText(content: unknown): string | null | "image" {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  let image = false;
  const parts: string[] = [];
  for (const p of content) {
    if (typeof p === "string") { parts.push(p); continue; }
    if (!p || typeof p !== "object") return null;
    const part = p as { type?: string; text?: string };
    if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
    else if (part.type === "image_url" || part.type === "image" || part.type === "input_image") image = true;
    else return null;
  }
  if (image) return "image";
  return parts.join("\n");
}

export type ChatPlan =
  | { ok: true; kind: "auto" }
  | { ok: true; kind: "lane"; id: string; provider: string; upstream: string; noKey: boolean; transport: "chat" | "provider-run"; strengths: Strength[] }
  | { ok: false; status: number; body: ReturnType<typeof openAIError> };

export function planChat(body: { model?: unknown }, data: GatewayModel[]): ChatPlan {
  const raw = body?.model;
  const requested = raw == null || raw === "" ? "auto" : String(raw).trim();
  if (!requested || requested === "auto") return { ok: true, kind: "auto" };
  const exact = data.find((m) => m.id === requested);
  const hits = exact ? [exact] : data.filter((m) => m.sam.upstream === requested || (m.sam.aliases ?? []).includes(requested));
  if (hits.length === 0) {
    return { ok: false, status: 404, body: openAIError(`no free model named ${requested}`, "invalid_request_error", "model_not_found") };
  }
  if (hits.length > 1) {
    return { ok: false, status: 400, body: openAIError(`"${requested}" matches more than one free lane — use the full id (${hits.slice(0, 4).map((h) => h.id).join(", ")})`, "invalid_request_error", "ambiguous_model") };
  }
  const hit = hits[0];
  if (!hit.sam.strengths.includes("text")) {
    return { ok: false, status: 400, body: openAIError(`${hit.id} is not a chat model (it is ${hit.sam.strengths.join(", ")})`, "invalid_request_error", "not_chat_model") };
  }
  if (!hit.sam.callable) {
    return { ok: false, status: 401, body: openAIError(`SAM has no key for ${hit.sam.provider} and that lane has no keyless path`, "invalid_request_error", "no_key") };
  }
  const noKey = hit.sam.provider === "pollinations" || hit.sam.provider === "hermes";
  const transport = hit.sam.provider === "hermes" ? "provider-run" : "chat";
  return { ok: true, kind: "lane", id: hit.id, provider: hit.sam.provider, upstream: hit.sam.upstream, noKey, transport, strengths: hit.sam.strengths };
}

function completion(model: string, text: string) {
  return {
    id: `chatcmpl-${randomBytes(8).toString("hex")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  };
}

export type ChatHandlerResult =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "stream"; model: string; run: (onDelta: (t: string) => void) => Promise<void> };

export async function handleChatCompletion(body: { model?: unknown; messages?: unknown; stream?: unknown }): Promise<ChatHandlerResult> {
  const flat = flattenChat(body?.messages);
  if ("error" in flat) return { kind: "json", status: 400, body: openAIError(flat.error, "invalid_request_error", "invalid_messages") };
  const list = await gatewayModelList();
  const plan = planChat(body ?? {}, list.data);
  if (!plan.ok) return { kind: "json", status: plan.status, body: plan.body };
  const stream = body?.stream === true;

  if (plan.kind === "auto") {
    const r = await runModel("free", flat.system, flat.prompt);
    if (r.provider === "none" || !r.text) {
      return { kind: "json", status: 503, body: openAIError("no free lane answered", "api_error", "no_lane") };
    }
    if (!stream) return { kind: "json", status: 200, body: completion(r.provider, r.text) };
    const text = r.text;
    return { kind: "stream", model: r.provider, run: async (onDelta) => { onDelta(text); } };
  }

  const runLane = async (): Promise<string> => {
    if (plan.transport === "provider-run") {
      const prov = PROVIDERS.find((p) => p.id === plan.provider);
      if (!prov) throw Object.assign(new Error("missing lane"), { status: 404 });
      const out = await relayBrain(
        { id: prov.id, boundary: "cloud", noKey: prov.noKey, run: prov.run },
        flat.system, flat.prompt, { allowCloud: true },
      );
      if (!out.ok) throw Object.assign(new Error(out.error.kind), { code: out.error.kind });
      return out.value;
    }
    const out = await relayBrain(
      {
        id: plan.provider,
        boundary: "cloud",
        noKey: plan.noKey,
        run: (s, p, k) => callFreeChat(plan.provider, plan.upstream, s, p, k, flat.wire),
      },
      flat.system, flat.prompt, { allowCloud: true },
    );
    if (!out.ok) throw Object.assign(new Error(out.error.kind), { code: out.error.kind });
    return out.value;
  };

  const fail = (e: unknown): ChatHandlerResult => {
    const code = (e as { code?: string })?.code;
    if (code === "no-key") return { kind: "json", status: 401, body: openAIError(`SAM has no key for ${plan.provider} and that lane has no keyless path`, "invalid_request_error", "no_key") };
    if (code === "breaker-open") return { kind: "json", status: 503, body: openAIError(`${plan.id} is cooling down after failures`, "api_error", "breaker_open") };
    return { kind: "json", status: 502, body: openAIError(`the free lane ${plan.id} did not answer`, "api_error", "upstream_error") };
  };

  // Hermes (and any provider-run lane) keeps its existing fallback — Nous key, else OpenRouter,
  // else local — so streaming must not bypass that by posting an empty bearer at the Nous URL.
  if (!stream || plan.transport !== "chat") {
    try {
      const text = await runLane();
      if (!text) return { kind: "json", status: 502, body: openAIError(`the free lane ${plan.id} returned nothing`, "api_error", "empty") };
      if (!stream) return { kind: "json", status: 200, body: completion(plan.id, text) };
      return { kind: "stream", model: plan.id, run: async (onDelta) => { onDelta(text); } };
    } catch (e) { return fail(e); }
  }

  if (!plan.noKey && poolSize(plan.provider) === 0) {
    return { kind: "json", status: 401, body: openAIError(`SAM has no key for ${plan.provider} and that lane has no keyless path`, "invalid_request_error", "no_key") };
  }
  const key = plan.noKey ? "" : (getKey(plan.provider) ?? "");
  if (!plan.noKey && !key) {
    return { kind: "json", status: 401, body: openAIError(`SAM has no key for ${plan.provider} and that lane has no keyless path`, "invalid_request_error", "no_key") };
  }
  return {
    kind: "stream",
    model: plan.id,
    run: async (onDelta) => {
      const tokensIn = estTokens(flat.system) + estTokens(flat.prompt);
      try {
        const text = await streamFreeChat(plan.provider, plan.upstream, flat.system, flat.prompt, key, onDelta);
        recordLaneCall(plan.provider, plan.noKey ? "nokey" : slotId(key), { ok: !!text, tokensIn, tokensOut: estTokens(text || "") });
        if (text && !plan.noKey) reportSuccess(plan.provider, key);
        if (!text) throw Object.assign(new Error("empty"), { code: "failed" });
      } catch (e) {
        const status = (e as { status?: number })?.status;
        recordLaneCall(plan.provider, plan.noKey ? "nokey" : slotId(key), { ok: false, status, tokensIn });
        if (!plan.noKey && key) reportFailure(plan.provider, key, status, (e as { retryAfterMs?: number })?.retryAfterMs);
        throw e;
      }
    },
  };
}
