// Local comparison page. Counts come from the gateway list and the lane wallet.
// Subscription prices are copied only from a successful fetch of the vendor page.
// A failed fetch omits that price. Nothing here is a payment link for SAM.

export const PRICE_PAGES = {
  chatgpt: "https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus",
  claude: "https://claude.com/pricing",
  google: "https://gemini.google/us/subscriptions/?hl=en",
} as const;

export interface ComparisonModel {
  id: string;
  sam: { callable: boolean; strengths: string[] };
}

export interface ComparisonWallet {
  note: string;
  combined: { healthy: number; remainingToday: number | null; unlimited: number };
}

export interface PublishedPrice {
  label: string;
  detail: string;
  href: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function parseChatGptPlus(html: string): string | null {
  if (!/ChatGPT Plus/i.test(html)) return null;
  const m = html.match(/\$(\d+(?:\.\d{2})?)\s*\/\s*month/i);
  return m ? `$${m[1]}/month` : null;
}

export function parseClaudePro(html: string): { monthly: string; annualPerMonth: string; annualUpfront: string } | null {
  const per = html.match(/data-plan="pro_annual"[^>]*data-plan-field="amount_per_month">\s*\$(\d+(?:\.\d{2})?)\s*</);
  const total = html.match(/data-plan="pro_annual"[^>]*data-plan-field="amount_total">\s*\$(\d+(?:\.\d{2})?)\s*</);
  const monthly = html.match(/data-plan="pro_monthly">\s*\$(\d+(?:\.\d{2})?)\s*</);
  if (!per || !total || !monthly || per.index === undefined) return null;
  const window = html.slice(Math.max(0, per.index - 80), per.index + 900);
  if (!/billed up front/i.test(window) || !/billed monthly/i.test(window)) return null;
  return { monthly: `$${monthly[1]}`, annualPerMonth: `$${per[1]}`, annualUpfront: `$${total[1]}` };
}

export function parseGoogleAiUs(html: string): { plus: string; pro: string } | null {
  if (!html.includes("United States")) return null;
  let plus: string | null = null;
  let pro: string | null = null;
  for (const m of html.matchAll(/class="price-amount">(\$[\d,]+(?:\.\d{2})?)</g)) {
    const at = m.index ?? 0;
    const prev = html.slice(Math.max(0, at - 2500), at);
    const plusAt = prev.lastIndexOf("Google AI Plus");
    const proAt = prev.lastIndexOf("Google AI Pro");
    const ultraAt = prev.lastIndexOf("Google AI Ultra");
    const nearest = Math.max(plusAt, proAt, ultraAt);
    if (nearest < 0) continue;
    if (nearest === plusAt && !plus) plus = m[1];
    else if (nearest === proAt && !pro) pro = m[1];
  }
  if (!plus || !pro) return null;
  return { plus, pro };
}

export function publishedPricesFromHtml(pages: { chatgpt?: string; claude?: string; google?: string }): PublishedPrice[] {
  const out: PublishedPrice[] = [];
  const chatgpt = pages.chatgpt ? parseChatGptPlus(pages.chatgpt) : null;
  if (chatgpt) {
    out.push({
      label: "ChatGPT Plus",
      detail: `${chatgpt}, billed monthly, from OpenAI's help page.`,
      href: PRICE_PAGES.chatgpt,
    });
  }
  const claude = pages.claude ? parseClaudePro(pages.claude) : null;
  if (claude) {
    out.push({
      label: "Claude Pro",
      detail: `${claude.monthly} if billed monthly, or ${claude.annualPerMonth} a month when ${claude.annualUpfront} is billed up front for the year.`,
      href: PRICE_PAGES.claude,
    });
  }
  const google = pages.google ? parseGoogleAiUs(pages.google) : null;
  if (google) {
    out.push({
      label: "Google AI",
      detail: `Plus ${google.plus} and Pro ${google.pro} a month, on the page labeled United States.`,
      href: PRICE_PAGES.google,
    });
  }
  return out;
}

async function readHtml(f: typeof fetch, url: string): Promise<string> {
  try {
    const r = await f(url, { signal: AbortSignal.timeout(8000), headers: { accept: "text/html" } });
    if (!r.ok) return "";
    return await r.text();
  } catch {
    return "";
  }
}

export async function fetchPublishedPrices(f: typeof fetch = fetch): Promise<PublishedPrice[]> {
  const [chatgpt, claude, google] = await Promise.all([
    readHtml(f, PRICE_PAGES.chatgpt),
    readHtml(f, PRICE_PAGES.claude),
    readHtml(f, PRICE_PAGES.google),
  ]);
  return publishedPricesFromHtml({ chatgpt, claude, google });
}

function countStrength(models: ComparisonModel[], strength: string, callable: boolean): number {
  return models.filter((m) => m.sam.strengths.includes(strength) && m.sam.callable === callable).length;
}

export function renderWhatYouGetHtml(input: { models: ComparisonModel[]; wallet: ComparisonWallet; prices: PublishedPrice[] }): string {
  const models = [...input.models].sort((a, b) => a.id.localeCompare(b.id));
  const callable = models.filter((m) => m.sam.callable);
  const listed = models.filter((m) => !m.sam.callable);
  const remaining = input.wallet.combined.remainingToday;
  const remainingText = remaining == null
    ? "The wallet did not report how many free requests remain today."
    : `${remaining} free requests remaining today. That is a request count, not money.`;
  const listedItems = listed.length
    ? listed.map((m) => `<li>${esc(m.id)} — not callable</li>`).join("")
    : "<li>None. Every model on the list can be called.</li>";
  const priceBlock = input.prices.length
    ? input.prices.map((p) => `<article><h3>${esc(p.label)}</h3><p>${esc(p.detail)} <a href="${esc(p.href)}">${esc(p.href)}</a></p></article>`).join("")
    : "<p>Published subscription prices are left out. Those pages did not return a price just now.</p>";
  const videoListed = countStrength(models, "video", false);
  const videoCallable = countStrength(models, "video", true);
  const audioListed = countStrength(models, "audio", false);
  const audioCallable = countStrength(models, "audio", true);
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>What you get</title>
<style>
  body { margin: 0; font: 17px/1.45 ui-sans-serif, system-ui, sans-serif; background: #111; color: #f4f1ea; }
  main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  h1 { font-size: 2rem; font-weight: 560; margin: 0 0 .5rem; }
  h2 { font-size: 1rem; letter-spacing: .04em; text-transform: uppercase; margin: 2rem 0 .5rem; }
  p, li { color: #ddd; }
  a { color: inherit; }
  .nums { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .nums strong { display: block; font-size: 2rem; }
</style>
<main>
  <h1>What you get</h1>
  <p>This page is on this computer only. SAM does not take payment.</p>
  <div class="nums">
    <p><strong>${callable.length}</strong> models you can call</p>
    <p><strong>${listed.length}</strong> listed only, not callable</p>
  </div>
  <h2>Listed only</h2>
  <p>These ids are on the gateway list and are not callable. SAM does not pretend a missing key is a live lane.</p>
  <ul>${listedItems}</ul>
  <p>Video models you can call: ${videoCallable}. Video models listed only: ${videoListed}. Audio models you can call: ${audioCallable}. Audio models listed only: ${audioListed}.</p>
  <h2>Free requests</h2>
  <p>${esc(remainingText)} ${input.wallet.combined.unlimited} lanes have no published daily cap. ${input.wallet.combined.healthy} lanes are healthy.</p>
  <p>${esc(input.wallet.note)}</p>
  <p>Research is not legal advice.</p>
  <h2>What a paid chat publishes</h2>
  ${priceBlock}
  <p>The contrast is how many models you can call here, against a subscription for one company. This page does not say SAM is better at the work than GPT or Claude.</p>
</main>
</html>
`;
}
