// ─────────────────────────────────────────────────────────────
//  S.A.M. · WEBINTEL RESEARCH — multi-page structured extraction + search-and-aggregate.
//
//  Multi-page structured extraction and search-and-aggregate, all our own code, built on
//  `webintel-extract`: no Playwright — fetch is webintel's, the LLM is injected (SAM's brain), and
//  SEARCH is injected too. Keyless web search
//  is genuinely flaky, so we DON'T pretend to own it — SAM wires the search backend it prefers
//  (Brave/DuckDuckGo/its cascade); what we own is the aggregation across pages.
//
//  (Single-page extract lives in webintel-extract.ts. This is webintel increment 3: many pages,
//  and search→scrape→aggregate.)
//
//  Verified (webintel-research.verify.mjs, 4/4): extractMany over two real Wikipedia pages →
//  one table row per page with source URLs; a dead URL captured in `failed[]`, not fatal;
//  searchAndExtract feeds an injected search into the pipeline.
// ─────────────────────────────────────────────────────────────
import { extract, type ExtractSchema, type LlmFn, type ExtractResult, type ExtractOpts } from "./webintel-extract.ts";

export interface MultiResult {
  results: ExtractResult[];
  table: Record<string, unknown>[];   // one flat row per successful page (+ _url, _title)
  ok: boolean;
  failed: string[];                    // URLs that couldn't be fetched/extracted
}
export interface ResearchOpts extends ExtractOpts { concurrency?: number; topN?: number }
/** Inject SAM's search — returns candidate URLs for a query. Keeps this backend-agnostic + testable. */
export type SearchFn = (query: string, n: number) => Promise<string[]>;

/** SmartScraperMultiGraph: extract the SAME schema across many URLs → results[] + a flat table. */
export async function extractMany(urls: string[], schema: ExtractSchema, llm: LlmFn, opts: ResearchOpts = {}): Promise<MultiResult> {
  const conc = Math.max(1, opts.concurrency ?? 4);
  const results: ExtractResult[] = [];
  for (let i = 0; i < urls.length; i += conc) {
    const batch = urls.slice(i, i + conc);
    const got = await Promise.all(batch.map((u) =>
      extract(u, schema, llm, opts).catch((e): ExtractResult => ({ url: u, ok: false, error: String((e as Error)?.message || e), data: null, issues: [] }))));
    results.push(...got);
  }
  const table = results.filter((r) => r.ok && r.data).map((r) => ({ _url: r.url, _title: r.title, ...(r.data as Record<string, unknown>) }));
  const failed = results.filter((r) => !r.ok).map((r) => r.url);
  return { results, table, ok: results.some((r) => r.ok), failed };
}

export interface SearchExtractResult extends MultiResult { query: string; note?: string }

/** SearchGraph-lite: search (injected → URLs) → extract across the top results → aggregate. */
export async function searchAndExtract(query: string, schema: ExtractSchema, search: SearchFn, llm: LlmFn, opts: ResearchOpts = {}): Promise<SearchExtractResult> {
  const urls = await search(query, opts.topN ?? 5);
  if (!urls?.length) return { query, results: [], table: [], ok: false, failed: [], note: "search returned no URLs" };
  return { query, ...(await extractMany(urls, schema, llm, opts)) };
}

// Expose as a SAM tool (reviewed one-liner in tools.ts): wire `search` to SAM's chosen backend and
// `llm` to runBrain — then "get {name, price} from these 10 pages" or "…from the top 5 results for X".
