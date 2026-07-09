// `npm run rollback` / `sam rollback` — reinstall the previous SAM release if an update broke something.
// Finds the release before this one on GitHub and opens its installer download. Your vault/data stays.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { previousRelease } from "../server/rollback.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const current = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";

const target = await previousRelease(current, process.argv.includes("--beta"));
if (!target) { console.log(`No earlier release than v${current} found on GitHub.`); process.exit(0); }

const link = target.asset?.url || target.releaseUrl;
console.log(`\n↩️  Rolling back from v${current} → v${target.version}`);
console.log(`   ${target.asset ? `Installer: ${target.asset.name}` : `Release page: ${target.releaseUrl}`}`);
console.log(`   Your vault, memory and settings stay exactly as they are.\n`);
execFile(openCmd, [link], () => console.log(`Opened ${link}\nRun the installer to complete the rollback.`));
