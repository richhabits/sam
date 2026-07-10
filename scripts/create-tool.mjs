#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  SAM · create-tool — scaffold a new tool stub + print how to wire it.
//  Usage:  npm run create-tool my_tool_name   [--dangerous]
// ─────────────────────────────────────────────────────────────
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const name = (args.find((a) => !a.startsWith("--")) || "").trim();
const dangerous = args.includes("--dangerous");

if (!/^[a-z][a-z0-9_]{2,39}$/.test(name)) {
  console.error("✗ Usage: npm run create-tool <snake_case_name> [--dangerous]\n  (3–40 chars, lowercase, starts with a letter)");
  process.exit(1);
}

const dir = join(root, "server", "tools-extra");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const file = join(dir, `${name}.ts`);
if (existsSync(file)) { console.error(`✗ ${file} already exists`); process.exit(1); }

const stub = `import type { Tool } from "../tools.ts";

// ${name} — describe what it does in one line.
// safe: ${dangerous ? "false — DANGEROUS (also add \"" + name + "\" to DANGEROUS in server/authz.ts)" : "set false if it writes/changes anything; true only for read-only/harmless"}.
export const ${name}: Tool = {
  name: "${name}",
  safe: ${dangerous ? "false" : "true"},
  description: "TODO: what it does + input shape, tightly (the model reads this).",
  params: "TODO: e.g. { query }",
  activity: (i) => \`Running ${name}…\`,
  run: async (input) => {
    // TODO: implement. Never interpolate input into a shell string — use execFile with an args array.
    return "TODO: ${name} result";
  },
};
`;

writeFileSync(file, stub);
console.log(`✓ Scaffolded ${file.replace(root + "/", "")}

Next:
  1. Implement run() in that file.
  ${dangerous ? "2. Add \"" + name + "\" to the DANGEROUS set in server/authz.ts (it's outward-facing/destructive).\n  " : ""}${dangerous ? "3" : "2"}. Register it: in server/tools.ts, import { ${name} } and add it to the TOOLS array.
  ${dangerous ? "4" : "3"}. Add a test, then: npm test

See docs/BUILD-A-TOOL.md for the full guide.`);
