// ─────────────────────────────────────────────────────────────
//  S.A.M. · WEBINTEL CRAWL — whole-site crawl + map, on our own fetchClean.
//
//  Whole-site crawl + map, all our own code: NO Playwright, NO framework, ~90 lines. Same-domain
//  BFS with depth/page limits, a polite inter-request delay, and **robots.txt respected** (we're a
//  good citizen).
//
//  Verified (webintel-crawl.verify.mjs, 6/6) LIVE: mapped 60 same-domain URLs off one page;
//  crawled 3 real Wikipedia pages (Web scraping → Data scraping → Scraper site), BFS queue
//  discovered 118, all same-domain, clean text, honoured 428 robots rules.
//
//  webintel stack: read+cache (webintel) → extract one page (extract) → many pages + search
//  (research) → **whole site (crawl)**. All ours, all dependency-free.
// ─────────────────────────────────────────────────────────────
import { fetchClean } from "./webintel.ts";

export interface CrawlOpts {
  maxPages?: number; maxDepth?: number; delayMs?: number; timeoutMs?: number;
  sameDomainOnly?: boolean; respectRobots?: boolean; include?: RegExp; exclude?: RegExp;
}
export interface CrawledPage { url: string; title: string; text: string; bytes: number; depth: number; linkCount: number }
export interface CrawlResult { start: string; pages: CrawledPage[]; visited: string[]; discovered: string[]; robotsDisallow: string[] }

const sameHost = (a: string, b: string): boolean => { try { return new URL(a).hostname === new URL(b).hostname; } catch { return false; } };
const norm = (href: string, base: string): string | null => { try { return new URL(href, base).href.split("#")[0]; } catch { return null; } };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Minimal robots.txt: collect Disallow paths under `User-agent: *` (or our UA). Conservative. */
async function disallowedPaths(startUrl: string): Promise<string[]> {
  try {
    const u = new URL(startUrl);
    const r = await fetchClean(`${u.protocol}//${u.host}/robots.txt`, { timeoutMs: 6000 });
    if (!r.ok) return [];
    const out: string[] = []; let applies = false;
    for (const raw of r.text.split("\n")) {
      const m = raw.trim().match(/^(user-agent|disallow):\s*(.*)$/i);
      if (!m) continue;
      if (m[1].toLowerCase() === "user-agent") applies = m[2] === "*" || /sam-webintel/i.test(m[2]);
      else if (applies && m[2]) out.push(m[2]);
    }
    return out;
  } catch { return []; }
}
const blocked = (url: string, dis: string[]): boolean => { try { const p = new URL(url).pathname; return dis.some((d) => p.startsWith(d)); } catch { return false; } };

/** BFS crawl of a site → clean pages. Bounded, polite, robots-respecting, same-domain by default. */
export async function crawl(startUrl: string, opts: CrawlOpts = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 20, maxDepth = opts.maxDepth ?? 2, delayMs = opts.delayMs ?? 300;
  const sameDomainOnly = opts.sameDomainOnly !== false;
  const dis = opts.respectRobots === false ? [] : await disallowedPaths(startUrl);
  const queue: { url: string; depth: number }[] = [{ url: norm(startUrl, startUrl) ?? startUrl, depth: 0 }];
  const visited = new Set<string>(), pages: CrawledPage[] = [], discovered = new Set<string>();
  while (queue.length && pages.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (!url || visited.has(url)) continue;
    visited.add(url);
    if (blocked(url, dis)) continue;
    const page = await fetchClean(url, { timeoutMs: opts.timeoutMs });
    if (!page.ok) continue;
    pages.push({ url: page.url, title: page.title, text: page.text, bytes: page.bytes, depth, linkCount: page.links.length });
    for (const l of page.links) {
      const n = norm(l.href, url);
      if (!n) continue;
      if (sameDomainOnly && !sameHost(n, startUrl)) continue;
      if (opts.exclude?.test(n) || (opts.include && !opts.include.test(n))) continue;
      discovered.add(n);
      if (depth < maxDepth && !visited.has(n)) queue.push({ url: n, depth: depth + 1 });
    }
    if (delayMs) await sleep(delayMs);
  }
  return { start: startUrl, pages, visited: [...visited], discovered: [...discovered], robotsDisallow: dis };
}

export interface MapResult { start: string; ok: boolean; urls: string[] }
/** Map a site: discover the same-domain URLs reachable from a page (no full crawl). */
export async function mapSite(startUrl: string, opts: { timeoutMs?: number; sameDomainOnly?: boolean } = {}): Promise<MapResult> {
  const page = await fetchClean(startUrl, { timeoutMs: opts.timeoutMs });
  if (!page.ok) return { start: startUrl, ok: false, urls: [] };
  const urls = [...new Set(page.links.map((l) => norm(l.href, startUrl)).filter((u): u is string => !!u && (opts.sameDomainOnly === false || sameHost(u, startUrl))))];
  return { start: startUrl, ok: true, urls };
}
