import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { withLatchSync } from "./latch.ts";

// Writing to the user's .env — pulled out of index.ts because the admin routes and five other
// call sites both need it, which is exactly what kept the admin section from being extractable.

// Packaged app sets DOTENV_CONFIG_PATH to a writable per-user .env; dev/CLI falls back to the
// repo .env next to the source (../.env, decoded for spaces in the install path).
export const ENV_PATH =
  process.env.DOTENV_CONFIG_PATH || fileURLToPath(new URL("../.env", import.meta.url));

// Same resolution, but read at CALL time. The Safe's migration sets DOTENV_CONFIG_PATH after this
// module loads (and tests point it at a scratch file), so the strip below must resolve fresh.
function envPathNow(): string {
  return process.env.DOTENV_CONFIG_PATH || fileURLToPath(new URL("../.env", import.meta.url));
}

/** Of `keys`, which appear as a non-empty `KEY=value` line in the .env FILE right now. This reflects
 *  what is plaintext AT REST — NOT process.env (which keeps a value in memory after the file is
 *  stripped). The Safe's migration preview uses this so it correctly empties once .env is cleaned. */
export function envKeysPresent(keys: string[]): string[] {
  let txt = "";
  try { txt = readFileSync(envPathNow(), "utf8"); } catch { return []; }
  const present = new Set<string>();
  for (const line of txt.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && m[2].trim() !== "") present.add(m[1]);
  }
  return keys.filter((k) => present.has(k));
}

/**
 * Remove one or more KEY=… lines from the .env entirely (used by the Safe's migration, which strips
 * plaintext secrets from .env once they're sealed and verified). File-only — leaves process.env
 * alone, so a caller that has already re-sourced the secret elsewhere is unaffected. Under the same
 * `env` Latch as writeEnv so a concurrent writer can't lose the update.
 */
export function removeEnvKeys(keys: string[]): void {
  if (!keys.length) return;
  const drop = new Set(keys);
  withLatchSync("env", () => {
    let txt = "";
    try { txt = readFileSync(envPathNow(), "utf8"); } catch { return; }   // no .env → nothing to strip
    const kept = txt.split("\n").filter((line) => {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
      return !(m && drop.has(m[1]));
    });
    writeFileSync(envPathNow(), kept.join("\n").replace(/\n*$/, "\n"));
  });
}

/**
 * Upsert one KEY=value line in the .env, and apply it live to process.env.
 *
 * Callers pass API keys and secrets. Two properties this must keep:
 *  - **one value = one line.** Newlines are stripped from the value, otherwise a value could
 *    carry its own `\nOTHER_KEY=...` and write env vars the caller never intended.
 *  - **`key` is trusted, `value` is not.** Key names come from the provider registry, never from
 *    request bodies, which is why the regex below can interpolate `key` directly. If a caller
 *    ever passes a user-supplied key, escape it first — see `env-file.test.ts`.
 */
export function writeEnv(key: string, value: string) {
  // Under a latch: .env is a shared artifact — the server, a CLI, and a second session can all
  // call this. The read-modify-write below is otherwise a lost-update race (two savers → one key
  // silently dropped). withLatchSync makes a concurrent writer fail loudly instead. See latch.ts.
  withLatchSync("env", () => {
    let txt = "";
    try {
      txt = readFileSync(ENV_PATH, "utf8");
    } catch {
      /* no .env yet — start from empty, it gets created on write */
    }
    value = value.replace(/[\r\n]/g, " "); // one value = one line — no .env line injection
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    txt = re.test(txt) ? txt.replace(re, line) : txt.replace(/\n?$/, "\n") + line + "\n";
    writeFileSync(ENV_PATH, txt);
    process.env[key] = value; // apply live
  });
}
