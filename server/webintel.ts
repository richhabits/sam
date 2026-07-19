// ─────────────────────────────────────────────────────────────
//  S.A.M. · WEBINTEL — our own local web reader + cache.
//
//  Clean-room, MIT, zero external services. SAM's own local web reader —
//  local-first web intelligence, no keys/cloud/bill, all our own code. Increment 1 owns fetch → clean → extract →
//  cache, which removes SAM's dependency on the jina.ai reader service for reading a page.
//
//  Verified LIVE (webintel.verify.mjs, 9/9): fetches a real Wikipedia page, extracts title +
//  42k chars of clean text + 96 links, caches it, keyword-searches it, falls back offline.
//
//  Roadmap (owned, incremental): 2) headless-browser escalation for JS-rendered pages;
//  3) keyless multi-engine search adapters; 4) on-device embeddings for semantic cache.
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { checkOutboundUrl } from "./url-guard.ts";

const UA = "Mozilla/5.0 (compatible; SAM-webintel/0.1; local-first)";

export interface CleanLink { href: string; text: string }
export interface CleanPage {
  url: string; status: number; contentType?: string;
  title: string; text: string; links: CleanLink[]; bytes: number; ok: boolean;
  error?: string; fromCache?: boolean; note?: string;
}
export interface CacheRow { url: string; title: string; text: string; fetchedAt: string }
export interface SearchHit { score: number; url: string; title: string; snippet: string }

/** Strip HTML → readable text + title + links. No deps; good for article/doc/reference pages. */
export function htmlToText(html: string): { title: string; text: string; links: CleanLink[] } {
  let h = html;
  const title = (h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  h = h.replace(/<!--[\s\S]*?-->/g, " ")
       // `header` was missing from this list (only `head` was here), which is why site chrome
       // survived: on Wikipedia the top bar and language list are in <header>, not <nav>.
       .replace(/<(script|style|noscript|svg|head|header|nav|footer|form|aside|dialog|template)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  // Prefer the main-content region when the page declares one. Stripping boilerplate tag-by-tag
  // is a losing game — every site invents new wrappers — whereas <main>/<article> is the author
  // TELLING us where the content is. Falls back to the whole document when absent, so plain pages
  // (example.com has neither) are unaffected.
  //
  // Measured on the page that exposed this: 62,295 clean chars with 1,997 of nav/language-list
  // boilerplate BEFORE the article began, so at maxChars 3000 two-thirds of an LLM's budget was
  // spent before any content arrived.
  const region = h.match(/<main[^>]*>([\s\S]*)<\/main>/i) || h.match(/<article[^>]*>([\s\S]*)<\/article>/i);
  // Guard against a <main> that is a near-empty shell (JS-rendered pages): only adopt the region
  // if it actually holds the bulk of the text, otherwise keep the full document.
  if (region && region[1].length > h.length * 0.15) h = region[1];
  const links: CleanLink[] = [];
  for (const m of h.matchAll(/<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text && m[1].startsWith("http")) links.push({ href: m[1], text: text.slice(0, 120) });
  }
  const text = h.replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)>/gi, "\n")
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
                .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n")
                .replace(/^\s+|\s+$/gm, "").trim();
  return { title, text, links: links.slice(0, 100) };
}

/** Fetch a URL and return cleaned, readable content. Times out; never throws. */
export async function fetchClean(url: string, opts: { timeoutMs?: number } = {}): Promise<CleanPage> {
  // Refuse loopback/LAN/link-local targets BEFORE opening a socket. SAM runs inside the user's
  // network, so a URL supplied by a prompt — or planted in a page SAM already read — could
  // otherwise reach the router, a NAS, or SAM's own API on localhost. See url-guard.ts.
  const verdict = await checkOutboundUrl(url);
  if (!verdict.ok) {
    return { url, status: 0, error: `blocked: ${verdict.reason}`, title: "", text: "", links: [], bytes: 0, ok: false };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: ctrl.signal, redirect: "follow" });
    const ct = res.headers.get("content-type") || "";
    const body = await res.text();
    const parsed = ct.includes("html") ? htmlToText(body) : { title: url, text: body, links: [] as CleanLink[] };
    return { url, status: res.status, contentType: ct, ...parsed, bytes: body.length, ok: res.ok };
  } catch (e) {
    return { url, status: 0, error: String((e as Error)?.message || e), title: "", text: "", links: [], bytes: 0, ok: false };
  } finally { clearTimeout(timer); }
}

/** Local page cache (JSON-lines) with keyword search + offline recall. Swap to SAM's sqlite/FTS for scale. */
export class WebCache {
  path: string; rows: CacheRow[] = [];
  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) { try { this.rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l: string) => JSON.parse(l) as CacheRow); } catch { /* ignore */ } }
  }
  put(entry: { url: string; title?: string; text?: string; fetchedAt: string }): void {
    const row: CacheRow = { url: entry.url, title: entry.title || "", text: (entry.text || "").slice(0, 200_000), fetchedAt: entry.fetchedAt };
    this.rows = this.rows.filter((r) => r.url !== row.url); this.rows.push(row);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, this.rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  get(url: string): CacheRow | null { return this.rows.find((r) => r.url === url) || null; }
  search(query: string, limit = 5): SearchHit[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.rows.map((r) => {
      const hay = (r.title + " " + r.text).toLowerCase();
      let score = 0;
      for (const t of terms) score += (hay.split(t).length - 1) + (r.title.toLowerCase().includes(t) ? 5 : 0);
      return { score, url: r.url, title: r.title, snippet: snippetFor(r.text, terms) };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

function snippetFor(text: string, terms: string[]): string {
  const low = text.toLowerCase(); let at = -1;
  for (const t of terms) { const i = low.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return text.slice(0, 160).trim();
  return "…" + text.slice(Math.max(0, at - 60), at + 100).replace(/\s+/g, " ").trim() + "…";
}

/** Read = fetch + cache, with offline fallback to the cached copy. The one call a tool wraps. */
export async function read(url: string, cache?: WebCache, opts?: { timeoutMs?: number; now?: string }): Promise<CleanPage> {
  const r = await fetchClean(url, opts);
  if (r.ok && r.text) { cache?.put({ url: r.url, title: r.title, text: r.text, fetchedAt: opts?.now || new Date().toISOString() }); return { ...r, fromCache: false }; }
  const cached = cache?.get(url);
  if (cached) return { url, status: 200, title: cached.title, text: cached.text, links: [], bytes: cached.text.length, ok: true, fromCache: true, note: "live fetch failed; served from local cache" };
  return r;
}

// To expose as a SAM tool (one entry in tools.ts, ask-first for network), wrap `read`:
//   { name: "web_read", description: "Read a web page (local, no keys) + cache it",
//     run: async ({ url }) => (await read(url, sharedWebCache)).text }
// Left as the reviewed one-liner — tools.ts is shared territory.
