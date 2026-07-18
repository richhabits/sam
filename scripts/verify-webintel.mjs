// LIVE verification for webintel — the network-touching complement to the CI tests
// (server/webintel.test.ts), which are deliberately offline so CI never flakes.
//
// Run:  node --experimental-strip-types scripts/verify-webintel.mjs
//
// It imports the REAL module from server/. It used to import a "./webintel.mjs" that was never
// landed, so it threw ERR_MODULE_NOT_FOUND and the "9/9 passed" receipt it advertised had
// never actually run on this disk. A verification script that cannot execute is worse than
// none: it reports success by existing.
import { htmlToText, fetchClean, WebCache, read } from "../server/webintel.ts";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
let pass=0, fail=0; const ok=(n,c)=>{(c?pass++:fail++);console.log(`  [${c?"PASS":"FAIL"}] ${n}`);};

// 1) pure: htmlToText strips junk, keeps title/text/links
const h = `<html><head><title>Hi There</title><style>x{}</style></head><body><nav>menu</nav><h1>Head</h1><p>Hello <b>world</b>.</p><a href="https://x.com/a">Link A</a><script>evil()</script></body></html>`;
const p = htmlToText(h);
ok("title extracted", p.title === "Hi There");
ok("script/style/nav removed from text", !/evil|menu|x\{\}/.test(p.text) && /Hello world/.test(p.text));
ok("links captured with anchor text", p.links.length === 1 && p.links[0].href === "https://x.com/a" && p.links[0].text === "Link A");

// 2) LIVE fetch + clean a real page
const w = await fetchClean("https://en.wikipedia.org/wiki/Circuit_breaker");
ok("live fetch ok", w.ok && w.bytes > 1000);
ok("live title extracted", /circuit breaker/i.test(w.title));
ok("live readable text (no tags)", w.text.length > 500 && !/</.test(w.text.slice(0, 2000)));
console.log(`      title: ${w.title.slice(0,60)} | text chars: ${w.text.length} | links: ${w.links.length}`);

// 3) cache: put/get/search + offline recall
const dir = mkdtempSync(join(tmpdir(), "webintel-"));
const cache = new WebCache(join(dir, "cache.jsonl"));
await read("https://en.wikipedia.org/wiki/Circuit_breaker", cache, { now: "2026-07-18" });
ok("cached after read", !!cache.get("https://en.wikipedia.org/wiki/Circuit_breaker"));
const hits = cache.search("circuit breaker trips");
ok("keyword search returns the page with a snippet", hits.length >= 1 && /circuit/i.test(hits[0].snippet));
const off = await read("https://en.wikipedia.org/wiki/Circuit_breaker", cache, { now: "x" }); // re-read hits cache path fine
ok("offline fallback path returns content", off.ok && off.text.length > 500);

console.log(`\n${fail===0?"ALL PASS":"FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail===0?0:1);
