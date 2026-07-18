// LIVE verification for webintel-extract — the network-touching complement to the CI tests
// (server/webintel-extract.test.ts), which are deliberately offline so CI never flakes.
//
// Run:  node --experimental-strip-types scripts/verify-webintel-extract.mjs
//
// It imports the REAL module from server/. It used to import a "./webintel-extract.mjs" that was never
// landed, so it threw ERR_MODULE_NOT_FOUND and the "9/9 passed" receipt it advertised had
// never actually run on this disk. A verification script that cannot execute is worse than
// none: it reports success by existing.
import { buildExtractPrompt, parseJsonLoose, coerceToSchema, extract } from "../server/webintel-extract.ts";
let pass=0, fail=0; const ok=(n,c)=>{(c?pass++:fail++);console.log(`  [${c?"PASS":"FAIL"}] ${n}`);};

// 1) prompt building
const schema = { title: "string", founded: "number", isPublic: "boolean", products: "string[]" };
const p = buildExtractPrompt(schema, "Acme Corp, founded 1999.", "Company facts.");
ok("prompt lists all fields + demands JSON", /"title": string/.test(p) && /"founded": number/.test(p) && /ONLY a JSON object/.test(p) && /Company facts/.test(p));

// 2) robust JSON parse: fenced, prefixed, trailing junk
ok("parses fenced json", JSON.stringify(parseJsonLoose('```json\n{"a":1}\n```')) === '{"a":1}');
ok("parses prefixed prose", parseJsonLoose('Sure! Here you go: {"a":2} hope that helps')?.a === 2);
ok("returns null on garbage", parseJsonLoose("no json here") === null);

// 3) coercion: strings→number/bool, missing flagged
const { value } = coerceToSchema({ title: "Acme", founded: "1999", isPublic: "yes", products: "widgets" }, schema);
ok("coerces '1999'->1999", value.founded === 1999);
ok("coerces 'yes'->true", value.isPublic === true);
ok("coerces scalar->string[]", Array.isArray(value.products) && value.products[0] === "widgets");
// THE CASE THIS SCRIPT WAS MISSING. It checked "1999"->1999 but never a garbage string, so
// coerce() returning 0 for "not a number" (Number("") === 0, not NaN) sailed through a receipt
// claiming 9/9. A fabricated number is worse than an admitted gap; null is the honest answer.
for (const junk of ["not a number", "unknown", "n/a", ""]) {
  const g = coerceToSchema({ founded: junk }, schema);
  ok(`garbage number ${JSON.stringify(junk)} -> null (not 0)`, g.value.founded === null);
}
ok("real numbers still parse ('£19.99' -> 19.99)", coerceToSchema({ founded: "£19.99" }, schema).value.founded === 19.99);
const miss = coerceToSchema({ title: "X" }, schema);
ok("flags missing fields", miss.issues.some((i) => i.includes("founded") && i.includes("missing")));

// 4) FULL PIPELINE: live-fetch a real page, mock the LLM (no keys needed), get structured data
const mockLlm = async (_sys, prompt) => {
  // a realistic model would read the page; here we assert the page text reached the prompt, then return JSON
  const hasPage = /circuit breaker/i.test(prompt);
  return "```json\n" + JSON.stringify({ title: hasPage ? "Circuit breaker" : "?", founded: null, isPublic: false, products: ["breaker"] }) + "\n```";
};
const r = await extract("https://en.wikipedia.org/wiki/Circuit_breaker", schema, mockLlm, { maxChars: 4000 });
ok("pipeline: real fetch → prompt → (mock) llm → parsed struct", r.ok && r.data.title === "Circuit breaker" && Array.isArray(r.data.products));
console.log(`      extracted: ${JSON.stringify(r.data)}`);

console.log(`\n${fail===0?"ALL PASS":"FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail===0?0:1);
