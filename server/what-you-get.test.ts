import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fetchPublishedPrices,
  parseChatGptPlus,
  parseClaudePro,
  parseGoogleAiUs,
  renderWhatYouGetHtml,
  type ComparisonModel,
  type ComparisonWallet,
} from "./what-you-get.ts";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

function model(id: string, callable: boolean, strengths: string[]): ComparisonModel {
  return { id, sam: { callable, strengths } };
}

const wallet = (remaining: number | null): ComparisonWallet => ({
  note: "Remaining free requests today, from the providers' own published limits. Not money. Research is not legal advice.",
  combined: { healthy: 2, remainingToday: remaining, unlimited: 1 },
});

const CHATGPT = "ChatGPT Plus is $20/month. Price: $20/month (billed monthly).";
const CLAUDE = `<p data-plan="pro_annual" data-plan-field="amount_per_month">$17</p>
<span data-plan="pro_annual" data-plan-field="amount_total">$200</span> billed up front).
<span data-plan="pro_monthly">$20</span> if billed monthly.`;
const GOOGLE = `aria-label="United States. Choose your country or region."
Google AI Plus</div><span class="price-amount">$4.99</span>
Google AI Pro</div><span class="price-amount">$19.99</span>
Google AI Ultra</div><span class="price-amount">$99.99</span>`;

describe("what you get", () => {
  const models = [
    model("groq/llama", true, ["text"]),
    model("fal/video", false, ["video", "audio"]),
    model("together/flux", false, ["images"]),
    model("groq/whisper", true, ["audio"]),
  ];

  it("counts callable models against listed-only models from the list it is given", () => {
    const html = renderWhatYouGetHtml({ models, wallet: wallet(12), prices: [] });
    expect(html).toContain("<strong>2</strong> models you can call");
    expect(html).toContain("<strong>2</strong> listed only, not callable");
    expect(html).toContain("fal/video — not callable");
    expect(html).toContain("together/flux — not callable");
    expect(html).not.toContain("groq/llama — not callable");
    expect(html).not.toContain("groq/whisper — not callable");
    expect(html).not.toMatch(/\b174\b|\b135\b|\b1049\b/);
  });

  it("keeps video and audio that are not callable visibly not live", () => {
    const html = renderWhatYouGetHtml({ models, wallet: wallet(12), prices: [] });
    expect(html).toContain("Video models you can call: 0. Video models listed only: 1.");
    expect(html).toContain("Audio models you can call: 1. Audio models listed only: 1.");
    expect(html).toContain("does not pretend a missing key is a live lane");
  });

  it("prints the wallet's remaining requests and does not invent a count", () => {
    const html = renderWhatYouGetHtml({ models, wallet: wallet(12), prices: [] });
    expect(html).toContain("12 free requests remaining today");
    expect(html).toContain("not money");
    expect(html).toContain("Research is not legal advice.");
    expect(html).toContain("This page is on this computer only. SAM does not take payment.");
    expect(html).toContain("does not say SAM is better at the work than GPT or Claude");
    const missing = renderWhatYouGetHtml({ models, wallet: wallet(null), prices: [] });
    expect(missing).toContain("did not report how many free requests remain");
    expect(missing).not.toMatch(/\b1049\b/);
  });

  it("escapes a listed-only id instead of treating it as markup", () => {
    const html = renderWhatYouGetHtml({
      models: [model("<script>", false, ["text"])],
      wallet: wallet(0),
      prices: [],
    });
    expect(html).toContain("&lt;script&gt; — not callable");
    expect(html).not.toContain("<script>");
  });

  it("keeps a published price only when that page actually states it", () => {
    expect(parseChatGptPlus(CHATGPT)).toBe("$20/month");
    expect(parseChatGptPlus("Access denied")).toBeNull();
    expect(parseClaudePro(CLAUDE)).toEqual({ monthly: "$20", annualPerMonth: "$17", annualUpfront: "$200" });
    expect(parseClaudePro("$17 $20 $200")).toBeNull();
    expect(parseGoogleAiUs(GOOGLE)).toEqual({ plus: "$4.99", pro: "$19.99" });
    expect(parseGoogleAiUs(GOOGLE.replace("United States", "United Kingdom").replaceAll("$", "£"))).toBeNull();
    const html = renderWhatYouGetHtml({
      models,
      wallet: wallet(12),
      prices: [],
    });
    expect(html).toContain("did not return a price");
    expect(html).not.toContain("$20/month");
    expect(html).not.toContain("$4.99");
  });

  it("asks the three vendor pages and drops any that fail", async () => {
    const f = (async (url: string) => {
      if (String(url).includes("openai.com")) return new Response("nope", { status: 403 });
      if (String(url).includes("claude.com")) return new Response(CLAUDE, { status: 200 });
      if (String(url).includes("gemini.google")) return new Response(GOOGLE, { status: 200 });
      throw new Error("unexpected");
    }) as typeof fetch;
    const prices = await fetchPublishedPrices(f);
    expect(prices.map((p) => p.label)).toEqual(["Claude Pro", "Google AI"]);
    expect(prices[0].detail).toContain("$17");
    expect(prices[0].detail).toContain("$200");
    expect(prices[1].detail).toContain("$4.99");
    const broken = await fetchPublishedPrices((async () => { throw new Error("offline"); }) as typeof fetch);
    expect(broken).toEqual([]);
  });

  it("serves /what-you-get from the live list and wallet behind the private read guard", () => {
    const a = src.indexOf('app.get("/what-you-get"');
    expect(a).toBeGreaterThan(-1);
    const next = src.slice(a).search(/\napp\.(get|post|put|delete|use)\(/);
    const body = src.slice(a, next === -1 ? undefined : a + next);
    expect(body).toContain("!canReadPrivate(req)");
    expect(body).toContain("gatewayModelList()");
    expect(body).toContain("laneWallet(lanesStatus())");
    expect(body).toContain("fetchPublishedPrices()");
    expect(body).not.toMatch(/\b174\b|\b135\b|\b1049\b/);
  });
});
