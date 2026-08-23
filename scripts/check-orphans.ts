import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

console.log("🔍 Checking for orphaned exports...");

// Extremely simple heuristic: find `export const foo` or `export function foo` in src/
// then grep the whole src directory to see if `foo` appears in any other file.

try {
  const exportsOutput = execSync("grep -rEo 'export (const|function) [a-zA-Z0-9_]+' src/ | grep -v 'test.ts'", { encoding: "utf8" });
  
  const exports = exportsOutput.split("\n").filter(Boolean).map(line => {
    // line looks like: src/lib/api.ts:export const executeSmartAction
    const parts = line.split(":");
    const file = parts[0];
    const words = parts[1].split(" ");
    const name = words[2]; // export const [name]
    return { file, name };
  });

  const orphans = [];
  for (const exp of exports) {
    if (!exp.name || exp.name === "default") continue;
    
    // Check if it's imported/used anywhere outside its own file
    // We grep for the word boundary
    try {
      const grepRes = execSync(`grep -rlE "\\b${exp.name}\\b" src/ | grep -v "${exp.file}"`, { encoding: "utf8" }).trim();
      if (!grepRes) {
        orphans.push(exp);
      }
    } catch (e) {
      // grep exit code 1 means not found (which means it's an orphan)
      orphans.push(exp);
    }
  }

  if (orphans.length === 0) {
    console.log("✅ No obvious orphans found.");
  } else {
    console.log("⚠️  Potential orphaned exports (exported but not used outside their own file):");
    orphans.forEach(o => console.log(`  - ${o.name}  (in ${o.file})`));
    console.log("\nNote: Some of these might be used dynamically or intentionally exported for future use.");
  }

} catch (e) {
  console.log("✅ No exports found or error running grep.");
}
