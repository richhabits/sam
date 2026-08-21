// ─────────────────────────────────────────────────────────────
//  S.A.M. · AUTONOMOUS DEEP RESEARCH SYNTHESIZER
//
//  Decomposes a research question into multiple angles, runs a real web search per angle,
//  and synthesizes a grounded brief where every claim cites a real source by [n] index.
//
//  AUDIT FIX: the original version of this file returned three hardcoded findings about
//  "inter-thread contention" and "zero-copy memory buffers" for EVERY query regardless of
//  topic, attributed to fake docs.local/benchmarks.local URLs, with a "consensus score" that
//  was mathematically constant (95%) since its inputs were both hardcoded literals. A user
//  asking about the Roman Empire would get back fabricated claims about memory caching
//  architecture, presented as cross-verified research. This version does real web search and
//  real LLM synthesis grounded in the actual results — search/synthesize are injected rather
//  than imported directly, since webSearch/runModel live in tools.ts, which imports THIS file
//  to register the tool; a direct import back would recreate the orchestrator-vs-tools.ts
//  circular-import bug fixed earlier this session.
// ─────────────────────────────────────────────────────────────

export interface ResearchFinding {
  claim: string;
  sourceIndex: number;
  confidence: number; // 0.0 to 1.0
}

export interface ResearchSource {
  index: number;
  title: string;
  url: string;
}

export interface DeepResearchReport {
  topic: string;
  depth: "quick" | "deep" | "exhaustive";
  executiveSummary: string;
  keyFindings: ResearchFinding[];
  consensusConfidencePct: number;
  dissentingOrConflictingViews: string[];
  sources: ResearchSource[];
  suggestedFollowups: string[];
}

export interface DeepResearchDeps {
  search: (q: string) => Promise<string>;
  synthesize: (system: string, prompt: string) => Promise<{ text: string }>;
}

export function decomposeResearchQuery(query: string): string[] {
  const clean = String(query || "").trim();
  if (!clean) return ["overview and key facts"];

  return [
    `${clean} overview and core principles`,
    `${clean} current state of the art benchmarks`,
    `${clean} tradeoffs risks and limitations`,
    `${clean} practical implementation and best practices`,
  ];
}

// A consensus score needs SOMETHING real to be derived from — this uses how many distinct
// sources the synthesized findings actually draw on (more independent sources agreeing → higher
// confidence the claims aren't a single source's idiosyncrasy), not a hardcoded constant.
export function calculateConsensusScore(findingsCount: number, distinctSourcesCount: number): number {
  if (findingsCount === 0) return 0;
  const ratio = distinctSourcesCount / Math.max(1, findingsCount);
  return Math.min(98, Math.max(30, Math.round(40 + ratio * 45)));
}

// webSearch()'s output format (see tools.ts): "• title — snippet\n  url" entries separated by
// newlines. Parsed into structured, de-duplicated (by URL) sources so [n] citations stay stable
// even when the same page turns up across multiple search angles.
function parseSearchResultsIntoSources(raw: string, sources: ResearchSource[], seenUrls: Set<string>): void {
  const entries = raw.split(/\n(?=•)/).filter(Boolean);
  for (const entry of entries) {
    const urlMatch = entry.match(/\n\s*(https?:\/\/\S+)/);
    const titleMatch = entry.match(/^•\s*(.+?)\s*—/);
    if (!urlMatch || seenUrls.has(urlMatch[1])) continue;
    seenUrls.add(urlMatch[1]);
    sources.push({ index: sources.length + 1, title: (titleMatch?.[1] || urlMatch[1]).trim(), url: urlMatch[1] });
  }
}

export async function conductDeepResearch(
  query: string,
  deps: DeepResearchDeps,
  options: { depth?: "quick" | "deep" | "exhaustive" } = {}
): Promise<DeepResearchReport> {
  const depth = options.depth || "deep";
  const clean = String(query || "").trim();
  const emptyReport = (summary: string, sources: ResearchSource[] = []): DeepResearchReport => ({
    topic: clean, depth, executiveSummary: summary, keyFindings: [],
    consensusConfidencePct: 0, dissentingOrConflictingViews: [], sources, suggestedFollowups: [],
  });
  if (!clean) return emptyReport("No research topic provided.");

  const subqueries = decomposeResearchQuery(clean);
  const searchCount = depth === "quick" ? 1 : depth === "exhaustive" ? 4 : 2;

  const searchResults = await Promise.all(
    subqueries.slice(0, searchCount).map(async (angle) => {
      try { return { angle, raw: await deps.search(angle) }; }
      catch (e: any) { return { angle, raw: `(search failed: ${e?.message || e})` }; }
    })
  );

  const sources: ResearchSource[] = [];
  const seenUrls = new Set<string>();
  for (const { raw } of searchResults) parseSearchResultsIntoSources(raw, sources, seenUrls);

  if (sources.length === 0) {
    return emptyReport(`Web search returned no usable results for "${clean}" — unable to produce a grounded research brief.`);
  }

  const sourcesBlock = sources.map((s) => `[${s.index}] ${s.title}\n${s.url}`).join("\n\n");
  const rawContext = searchResults.map((r) => `### Angle: ${r.angle}\n${r.raw}`).join("\n\n");

  const system = `You are SAM's deep research synthesizer. Given real web search results across multiple angles of a question, produce a rigorous, grounded research brief. Every claim in keyFindings MUST cite a real source by its [n] index from the SOURCES list below — never invent a source, a URL, or a claim the search results don't actually support. If the results conflict, are thin, or are inconclusive, say so explicitly in dissentingOrConflictingViews rather than picking a side. Return ONLY valid JSON matching this schema:
{
  "executiveSummary": "2-4 sentence summary grounded in the sources, using [n] citations",
  "keyFindings": [ { "claim": "a specific claim the sources actually support", "sourceIndex": 1, "confidence": 0.8 } ],
  "dissentingOrConflictingViews": ["contradictions or open questions found in the sources, or note if sources were too thin to assess"],
  "suggestedFollowups": ["a genuinely useful follow-up question given what these specific sources revealed"]
}`;
  const prompt = `TOPIC: "${clean}"\n\nSOURCES:\n${sourcesBlock}\n\nSEARCH RESULTS BY ANGLE:\n${rawContext}\n\nSynthesize the research brief now, citing only the sources above.`;

  try {
    const res = await deps.synthesize(system, prompt);
    const raw = (res.text || "").trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const jsonText = match ? match[0] : raw.replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(jsonText);

    const keyFindings: ResearchFinding[] = (Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [])
      .filter((f: any) => f && typeof f.claim === "string" && sources.some((s) => s.index === Number(f.sourceIndex)))
      .map((f: any) => ({
        claim: f.claim,
        sourceIndex: Number(f.sourceIndex),
        confidence: Math.min(1, Math.max(0, Number(f.confidence) || 0.5)),
      }));

    const distinctSources = new Set(keyFindings.map((f) => f.sourceIndex)).size;
    const consensusPct = calculateConsensusScore(keyFindings.length, distinctSources);

    return {
      topic: clean,
      depth,
      executiveSummary: String(parsed.executiveSummary || `Research synthesis for "${clean}", grounded in ${sources.length} source(s).`),
      keyFindings,
      consensusConfidencePct: consensusPct,
      dissentingOrConflictingViews: (Array.isArray(parsed.dissentingOrConflictingViews) ? parsed.dissentingOrConflictingViews : []).map(String),
      sources,
      suggestedFollowups: (Array.isArray(parsed.suggestedFollowups) ? parsed.suggestedFollowups : []).map(String),
    };
  } catch {
    return emptyReport(`Found ${sources.length} source(s) for "${clean}", but synthesis failed — see sources below rather than a fabricated summary.`, sources);
  }
}
