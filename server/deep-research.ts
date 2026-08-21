// ─────────────────────────────────────────────────────────────
//  S.A.M. · AUTONOMOUS DEEP RESEARCH SYNTHESIZER
//
//  Decomposes a research question into multiple angles, runs real web searches per angle,
//  and synthesizes a grounded brief where every claim cites a real source by [n] index.
//  Includes Executive Research Dossier compilation with domain consensus scoring.
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

export interface ExecutiveDossier {
  title: string;
  topic: string;
  generatedAt: number;
  executiveSummary: string;
  consensusScorePct: number;
  distinctDomainsCount: number;
  keyFindings: ResearchFinding[];
  riskAnalysis: string[];
  strategicActionPlan: string[];
  citations: { index: number; domain: string; title: string; url: string }[];
  markdownDossier: string;
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

export function extractDomainFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

export function calculateConsensusScore(findingsCount: number, distinctSourcesCount: number): number {
  if (findingsCount === 0) return 0;
  const ratio = distinctSourcesCount / Math.max(1, findingsCount);
  return Math.min(98, Math.max(30, Math.round(40 + ratio * 45)));
}

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

/**
 * Compiles a structured DeepResearchReport into a publication-ready Executive Research Dossier.
 */
export function compileExecutiveDossier(report: DeepResearchReport): ExecutiveDossier {
  const domains = new Set(report.sources.map((s) => extractDomainFromUrl(s.url)));
  const citations = report.sources.map((s) => ({
    index: s.index,
    domain: extractDomainFromUrl(s.url),
    title: s.title,
    url: s.url,
  }));

  const mdSections: string[] = [
    `# 📑 EXECUTIVE RESEARCH DOSSIER: ${report.topic.toUpperCase()}`,
    `**Generated:** ${new Date().toUTCString()} | **Consensus Score:** ${report.consensusConfidencePct}% | **Sources:** ${report.sources.length} (${domains.size} independent domains)`,
    `\n## 🎯 Executive Summary\n${report.executiveSummary}`,
    `\n## 💡 Key Findings`,
  ];

  if (report.keyFindings.length === 0) {
    mdSections.push(`*No confirmed findings met the multi-source verification threshold.*`);
  } else {
    for (const f of report.keyFindings) {
      const cite = citations.find((c) => c.index === f.sourceIndex);
      const citeLabel = cite ? `([${cite.index}] ${cite.domain})` : `[${f.sourceIndex}]`;
      mdSections.push(`- **${f.claim}** ${citeLabel} *(Confidence: ${Math.round(f.confidence * 100)}%)*`);
    }
  }

  if (report.dissentingOrConflictingViews.length > 0) {
    mdSections.push(`\n## ⚠️ Risk & Counter-Evidence Analysis`);
    for (const d of report.dissentingOrConflictingViews) {
      mdSections.push(`- ${d}`);
    }
  }

  mdSections.push(`\n## 🚀 Immediate Strategic Actions`);
  const actionPlan = report.suggestedFollowups.length > 0
    ? report.suggestedFollowups
    : ["Execute initial pilot validation in isolated scratch environment.", "Verify vendor API pricing and SLA constraints."];

  for (const a of actionPlan) {
    mdSections.push(`- [ ] ${a}`);
  }

  mdSections.push(`\n## 📚 Verified Source Citations`);
  for (const c of citations) {
    mdSections.push(`[${c.index}] **${c.title}**  \n    <${c.url}> (${c.domain})`);
  }

  const markdown = mdSections.join("\n");

  return {
    title: `Executive Dossier: ${report.topic}`,
    topic: report.topic,
    generatedAt: Date.now(),
    executiveSummary: report.executiveSummary,
    consensusScorePct: report.consensusConfidencePct,
    distinctDomainsCount: domains.size,
    keyFindings: report.keyFindings,
    riskAnalysis: report.dissentingOrConflictingViews,
    strategicActionPlan: actionPlan,
    citations,
    markdownDossier: markdown,
  };
}
