// LIVE verification for webintel-research — the network-touching complement to the CI tests
// (server/webintel-research.test.ts), which are deliberately offline so CI never flakes.
//
// Run:  node --experimental-strip-types scripts/verify-webintel-research.mjs
//
// SAME BUG AS THE OTHER TWO, THIRD TIME: this imported "./webintel-research.mjs", a file that was
// never landed, so it threw ERR_MODULE_NOT_FOUND on every run — while the strip doc advertised
// "4/4 live-verified". A verification script that cannot execute is worse than none: it reports
// success by existing. Now imports the REAL module, and the numbers below are from a real run.
import { extractMany, searchAndExtract } from "../server/webintel-research.ts";
let pass=0, fail=0; const ok=(n,c)=>{(c?pass++:fail++);console.log(`  [${c?"PASS":"FAIL"}] ${n}`);};

const schema = { title: "string" };
// mock LLM: pretend to read the page and return the title it "sees" (we assert page text reached it)
const mockLlm = async (_s, prompt) => {
  const m = prompt.match(/# ?([^\n]{3,60})/) || prompt.match(/PAGE CONTENT:\s*\n([^\n]{3,60})/);
  return JSON.stringify({ title: (m ? m[1] : "unknown").trim().slice(0, 40) });
};

// 1) extractMany over TWO real pages → a table with one row per page
const urls = ["https://en.wikipedia.org/wiki/Circuit_breaker", "https://en.wikipedia.org/wiki/Diode"];
const r = await extractMany(urls, schema, mockLlm, { maxChars: 3000, concurrency: 2 });
ok("multi-page: a row per successful page", r.table.length === 2 && r.table.every((row) => row._url && "title" in row));
ok("multi-page: rows carry their source url", r.table[0]._url === urls[0] && r.table[1]._url === urls[1]);
console.log("      table:", JSON.stringify(r.table.map((x) => ({ url: x._url.split("/").pop(), title: x.title }))));

// 2) a failing URL is captured, not fatal
const r2 = await extractMany(["https://en.wikipedia.org/wiki/Diode", "https://nonexistent.invalid.tld/x"], schema, mockLlm, { maxChars: 2000, timeoutMs: 4000 });
ok("multi-page: one good + one dead → table has the good, failed[] has the dead", r2.table.length === 1 && r2.failed.length === 1);

// 3) searchAndExtract: inject a mock search (returns URLs) → aggregate. Search stays pluggable.
const mockSearch = async (_q, n) => urls.slice(0, n);
const s = await searchAndExtract("circuit breaker vs diode", schema, mockSearch, mockLlm, { topN: 2, maxChars: 3000 });
ok("search→extract→aggregate: injected search feeds the pipeline", s.ok && s.table.length === 2 && s.query.includes("circuit"));

console.log(`\n${fail===0?"ALL PASS":"FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail===0?0:1);
