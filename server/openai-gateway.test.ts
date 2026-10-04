import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAT_BASE } from "./model-providers.ts";
import { SOURCES } from "./model-discovery.ts";
import {
  assembleGatewayInputs,
  buildGatewayModels,
  chatStrengths,
  DOCUMENTED_MEDIA,
  flattenChat,
  parsePollinations,
  planChat,
  type GatewayModel,
} from "./openai-gateway.ts";

const pol = [{
  name: "openai-fast",
  description: "GPT-OSS 20B Reasoning LLM (OVH)",
  tier: "anonymous",
  aliases: ["openai", "gpt-oss", "gpt-oss-20b", "ovh-reasoning"],
  vision: false,
  audio: false,
  input_modalities: ["text"],
  output_modalities: ["text"],
}, {
  name: "paid-only",
  tier: "seed",
  input_modalities: ["text"],
  output_modalities: ["text"],
}];

describe("free model catalogue", () => {
  it("keeps media ids that the image and video code already sends, and no others", () => {
    const tools = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");
    for (const m of DOCUMENTED_MEDIA) expect(tools, m.model).toContain(m.model);
    expect(DOCUMENTED_MEDIA.map((m) => m.provider)).not.toContain("leonardo");
    expect(DOCUMENTED_MEDIA.map((m) => m.provider)).not.toContain("cloudflare");
  });

  it("tags chat from the registry note and does not call a text model legal or an image model", () => {
    expect(chatStrengths("👁 photos & vision — reads images")).toEqual(["text", "vision"]);
    expect(chatStrengths("🧠 reasoning + 🎨 FREE images (FLUX)")).toEqual(["text"]);
    expect(JSON.stringify(chatStrengths("web-aware answers"))).not.toMatch(/legal/);
  });

  it("lists the one anonymous Pollinations model and does not pad aliases into extra rows", () => {
    expect(parsePollinations(pol).map((m) => m.name)).toEqual(["openai-fast"]);
    const data = buildGatewayModels(assembleGatewayInputs({
      cat: { v: 1, providers: {} },
      hasKey: () => false,
      pollinations: parsePollinations(pol),
      extraOpenRouter: [],
    }));
    const polls = data.filter((m) => m.owned_by === "pollinations");
    expect(polls.map((m) => m.sam.upstream)).toEqual(["openai-fast"]);
    expect(polls[0].sam.aliases).toEqual(expect.arrayContaining(["openai"]));
    expect(polls[0].sam.callable).toBe(true);
    expect(polls[0].sam.strengths).toEqual(["text"]);
    expect(data.some((m) => m.id.includes("gpt-oss-20b") || m.id.endsWith("/openai"))).toBe(false);
  });

  it("includes registry lanes and discovery ids, drops paid providers, and dedupes", () => {
    const nvidia = Array.from({ length: 100 }, (_, i) => `vendor/model-${i}`);
    const data = buildGatewayModels(assembleGatewayInputs({
      cat: {
        v: 1,
        providers: {
          nvidia: { models: nvidia, discoveredAt: "2026-10-03T22:46:35.205Z", configured: "x", active: "vendor/model-0", replaced: false },
          gemini: { models: ["gemini-2.5-flash"], discoveredAt: "2026-10-03T22:46:35.205Z", configured: "gemini-2.5-flash", active: "gemini-2.5-flash", replaced: false },
          openrouter: { models: ["nvidia/nemotron-3-super-120b-a12b:free"], discoveredAt: "2026-10-03T22:46:35.205Z", configured: "nvidia/nemotron-3-super-120b-a12b:free", active: "nvidia/nemotron-3-super-120b-a12b:free", replaced: false },
        },
      },
      hasKey: (id) => id === "groq" || id === "nvidia" || id === "gemini",
      pollinations: parsePollinations(pol),
      extraOpenRouter: ["qwen/qwen3.8-27b:free", "nvidia/nemotron-3-super-120b-a12b:free"],
    }));
    const ids = data.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(100);
    expect(data.some((m) => m.owned_by === "openai" || m.owned_by === "anthropic" || m.owned_by === "moonshot")).toBe(false);
    expect(data.find((m) => m.id === "gemini/gemini-2.5-flash")?.sam.strengths).toEqual(["text", "vision"]);
    expect(data.find((m) => m.id === "gemini/gemini-2.5-flash")?.sam.callable).toBe(true);
    expect(data.find((m) => m.id === "together/black-forest-labs/FLUX.1-schnell-Free")?.sam).toMatchObject({ strengths: ["images"], callable: false });
    const togetherChat = data.find((m) => m.owned_by === "together" && m.sam.strengths.includes("text"));
    expect(togetherChat?.sam.strengths).toEqual(["text"]);
    expect(data.find((m) => m.id === "groq/whisper-large-v3")?.sam.strengths).toEqual(["audio"]);
    expect(data.find((m) => m.id === "fal/alibaba/happy-horse/v1.1/text-to-video")?.sam.strengths).toEqual(["video", "audio"]);
    expect(data.filter((m) => m.id === "openrouter/nvidia/nemotron-3-super-120b-a12b:free")).toHaveLength(1);
    expect(data.some((m) => m.id === "openrouter/qwen/qwen3.8-27b:free")).toBe(true);
    expect(data.find((m) => m.id === "nvidia/vendor/model-0")?.created).toBe(Math.floor(Date.parse("2026-10-03T22:46:35.205Z") / 1000));
    for (const m of data) {
      expect(m.object).toBe("model");
      expect(m.owned_by).toBe(m.sam.provider);
      expect(m.id).toBe(`${m.sam.provider}/${m.sam.upstream}`);
    }
    // A lane with no key is listed and not claimed callable.
    expect(data.find((m) => m.owned_by === "mistral")?.sam.callable).toBe(false);
    expect(data.find((m) => m.owned_by === "groq" && m.sam.strengths.includes("text"))?.sam.callable).toBe(true);
  });

  it("uses the same zero-price :free filter as discovery", () => {
    const parse = SOURCES.find((s) => s.id === "openrouter")!.parse;
    expect(parse({
      data: [
        { id: "a/b:free", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["text"] } },
        { id: "a/c:free", pricing: { prompt: "0", completion: "0.1" } },
        { id: "paid/x", pricing: { prompt: "0", completion: "0" } },
      ],
    })).toEqual(["a/b:free"]);
    for (const url of Object.values(CHAT_BASE)) expect(url).not.toMatch(/api\.openai\.com|api\.anthropic\.com/);
  });
});

describe("chat routing", () => {
  const row = (over: Partial<GatewayModel> & Pick<GatewayModel, "id">): GatewayModel => ({
    object: "model",
    created: 0,
    owned_by: over.id.split("/")[0],
    sam: { provider: over.id.split("/")[0], upstream: over.id.slice(over.id.indexOf("/") + 1), strengths: ["text"], callable: true },
    ...over,
    sam: {
      provider: over.id.split("/")[0],
      upstream: over.id.slice(over.id.indexOf("/") + 1),
      strengths: ["text"],
      callable: true,
      ...over.sam,
    },
  });
  const models: GatewayModel[] = [
    row({ id: "groq/openai/gpt-oss-120b" }),
    row({ id: "cerebras/gpt-oss-120b" }),
    row({ id: "mistral/mistral-small-latest", sam: { provider: "mistral", upstream: "mistral-small-latest", strengths: ["text"], callable: false } }),
    row({ id: "fal/fal-ai/flux/schnell", sam: { provider: "fal", upstream: "fal-ai/flux/schnell", strengths: ["images"], callable: true } }),
    row({ id: "pollinations/openai-fast", sam: { provider: "pollinations", upstream: "openai-fast", strengths: ["text"], callable: true, aliases: ["openai"] } }),
    row({ id: "groq/same-slug" }),
    row({ id: "cerebras/same-slug" }),
  ];

  it("picks auto, refuses missing keys, and does not chat an image model", () => {
    expect(planChat({}, models)).toEqual({ ok: true, kind: "auto" });
    expect(planChat({ model: "auto" }, models)).toEqual({ ok: true, kind: "auto" });
    expect(planChat({ model: "nope" }, models).ok).toBe(false);
    if (!planChat({ model: "nope" }, models).ok) expect(planChat({ model: "nope" }, models)).toMatchObject({ status: 404 });
    const missing = planChat({ model: "mistral/mistral-small-latest" }, models);
    expect(missing).toMatchObject({ ok: false, status: 401 });
    const image = planChat({ model: "fal/fal-ai/flux/schnell" }, models);
    expect(image).toMatchObject({ ok: false, status: 400 });
    const hit = planChat({ model: "openai" }, models);
    expect(hit).toMatchObject({ ok: true, kind: "lane", provider: "pollinations", upstream: "openai-fast" });
    expect(planChat({ model: "gpt-oss-120b" }, models)).toMatchObject({ ok: true, kind: "lane", provider: "cerebras", upstream: "gpt-oss-120b" });
    expect(planChat({ model: "same-slug" }, models)).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects image parts instead of pretending they were read", () => {
    const bad = flattenChat([{ role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "http://x" } }] }]);
    expect(bad).toMatchObject({ error: expect.stringMatching(/text only/) });
    const ok = flattenChat([{ role: "system", content: "be brief" }, { role: "user", content: "hi" }]);
    expect(ok).toMatchObject({ system: "be brief", prompt: "hi" });
  });
});
