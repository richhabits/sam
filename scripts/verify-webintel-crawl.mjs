// LIVE verification for webintel-crawl. Run: node --experimental-strip-types scripts/verify-webintel-crawl.mjs
//
// FOURTH occurrence of the same bug: this imported "./webintel-crawl.mjs", a file that was never
// landed, so it threw ERR_MODULE_NOT_FOUND while the strip doc advertised "6/6 live-verified".
// scripts/verify-scripts.test.ts now fails CI if any verify script imports a path that does not
// exist — the lesson is enforced instead of re-learned.
import { crawl, mapSite } from "../server/webintel-crawl.ts";
let pass=0, fail=0; const ok=(n,c)=>{(c?pass++:fail++);console.log(`  [${c?"PASS":"FAIL"}] ${n}`);};

// 1) map: discover same-domain URLs from a real page
const m = await mapSite("https://en.wikipedia.org/wiki/Web_scraping", { timeoutMs: 15000 });
ok("map: discovers same-domain URLs", m.ok && m.urls.length > 10 && m.urls.every((u) => u.includes("en.wikipedia.org")));
console.log(`      mapped ${m.urls.length} same-domain URLs`);

// 2) crawl: BFS a real site, bounded (3 pages, depth 1), same-domain, robots-respected
const r = await crawl("https://en.wikipedia.org/wiki/Web_scraping", { maxPages: 3, maxDepth: 1, delayMs: 200, timeoutMs: 15000 });
ok("crawl: fetched up to the page limit", r.pages.length >= 2 && r.pages.length <= 3);
ok("crawl: all pages same domain", r.pages.every((p) => p.url.includes("en.wikipedia.org")));
ok("crawl: start page is depth 0, followed pages depth 1", r.pages[0].depth === 0 && r.pages.slice(1).every((p) => p.depth === 1));
ok("crawl: discovered more than it fetched (queue worked)", r.discovered.length > r.pages.length);
ok("crawl: pages carry clean text", r.pages.every((p) => p.text.length > 200 && !/</.test(p.text.slice(0, 500))));
console.log(`      crawled ${r.pages.length} pages, discovered ${r.discovered.length}, robots rules: ${r.robotsDisallow.length}`);
console.log("      titles:", r.pages.map((p) => p.title.split(" - ")[0]).join(" · "));

console.log(`\n${fail===0?"ALL PASS":"FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail===0?0:1);
