import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { withLatchSync } from "./latch.ts";

// Writing to the user's .env — pulled out of index.ts because the admin routes and five other
// call sites both need it, which is exactly what kept the admin section from being extractable.

// Packaged app sets DOTENV_CONFIG_PATH to a writable per-user .env; dev/CLI falls back to the
// repo .env next to the source (../.env, decoded for spaces in the install path).
export const ENV_PATH =
  process.env.DOTENV_CONFIG_PATH || fileURLToPath(new URL("../.env", import.meta.url));

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
