// ─────────────────────────────────────────────────────────────
//  S.A.M. · PEOPLE  — who SAM knows by sight
//  Stores your people by name + a short look-description (from
//  SAM's own vision). Injected into the vision prompt so SAM can
//  say "hey <friend>" — or flag "someone I don't recognise". Local
//  & private (vault/people.json, gitignored). No face data leaves
//  your machine; we store a text description, not the photo.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(process.env.VAULT_DIR || join(ROOT, "vault"), "people.json");

// `face` = a 128-float descriptor (face-api.js) computed IN THE BROWSER, on-device.
// It's just numbers — no photo, no image ever leaves the machine. Enables true
// recognition (cosine match) on top of the description-based greeting.
export interface Person { name: string; look: string; relation?: string; added: string; face?: number[] }

// mtime-cached: peopleContext() runs on every request, so only re-parse the file
// when it actually changes (was a disk read + JSON.parse per request).
let _cache: Person[] = [];
let _mtime = -1;
function load(): Person[] {
  try {
    if (!existsSync(FILE)) { _cache = []; _mtime = -1; return _cache; }
    const m = statSync(FILE).mtimeMs;
    if (m !== _mtime) { _cache = JSON.parse(readFileSync(FILE, "utf8")); _mtime = m; }
  } catch { /* keep last-good cache */ }
  return _cache;
}
function save(list: Person[]) {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(list, null, 2));
    _cache = list; _mtime = statSync(FILE).mtimeMs;   // keep cache hot after a write
  } catch { /* ignore */ }
}

export function addPerson(name: string, look: string, relation?: string, face?: number[]): Person {
  const list = load();
  const p: Person = { name: String(name).slice(0, 60), look: String(look || "").slice(0, 200), relation, added: new Date().toISOString(),
    ...(Array.isArray(face) && face.length === 128 ? { face } : {}) };
  const i = list.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase());
  if (i >= 0) list[i] = { ...list[i], ...p };   // keep an existing face if the new save omits one
  else list.push(p);
  save(list); return p;
}
export function listPeople(): Person[] { return load(); }

// The face descriptors the browser matches against (name + 128-float vector only).
export function faceRoster(): { name: string; relation?: string; face: number[] }[] {
  return load().filter((p) => Array.isArray(p.face) && p.face.length === 128).map((p) => ({ name: p.name, relation: p.relation, face: p.face! }));
}

// Injected into the vision prompt so SAM recognises your people.
export function peopleContext(): string {
  const list = load();
  if (!list.length) return "";
  return `People you know (recognise them by their look; greet them warmly by name):\n` +
    list.map((p) => `- ${p.name}${p.relation ? ` (${p.relation})` : ""}: ${p.look}`).join("\n") +
    `\nIf you see someone whose look does NOT match anyone above, say clearly that you don't recognise them.`;
}
