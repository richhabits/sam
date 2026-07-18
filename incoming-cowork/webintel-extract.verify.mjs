import { buildExtractPrompt, parseJsonLoose, coerceToSchema, extract } from "./webintel-extract.mjs";
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
const { value, issues } = coerceToSchema({ title: "Acme", founded: "1999", isPublic: "yes", products: "widgets" }, schema);
ok("coerces '1999'->1999", value.founded === 1999);
ok("coerces 'yes'->true", value.isPublic === true);
ok("coerces scalar->string[]", Array.isArray(value.products) && value.products[0] === "widgets");
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
