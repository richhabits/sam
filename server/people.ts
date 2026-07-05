// ─────────────────────────────────────────────────────────────
//  S.A.M. · PEOPLE  — who SAM knows by sight
//  Stores your people by name + a short look-description (from
//  SAM's own vision). Injected into the vision prompt so SAM can
//  say "hey Shady" — or flag "someone I don't recognise". Local
//  & private (vault/people.json, gitignored). No face data leaves
//  your machine; we store a text description, not the photo.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const FILE = join(process.env.VAULT_DIR || join(fileURLToPath(new URL("..", import.meta.url)), "vault"), "people.json");

export interface Person { name: string; look: string; relation?: string; added: string }

function load(): Person[] {
  try { if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")); } catch { /* ignore */ }
  return [];
}
function save(list: Person[]) {
  try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(list, null, 2)); } catch { /* ignore */ }
}

export function addPerson(name: string, look: string, relation?: string): Person {
  const list = load();
  const p: Person = { name: String(name).slice(0, 60), look: String(look || "").slice(0, 200), relation, added: new Date().toISOString() };
  const i = list.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase());
  if (i >= 0) list[i] = p; else list.push(p);
  save(list); return p;
}
export function listPeople(): Person[] { return load(); }

// Injected into the vision prompt so SAM recognises your people.
export function peopleContext(): string {
  const list = load();
  if (!list.length) return "";
  return `People you know (recognise them by their look; greet them warmly by name):\n` +
    list.map((p) => `- ${p.name}${p.relation ? ` (${p.relation})` : ""}: ${p.look}`).join("\n") +
    `\nIf you see someone whose look does NOT match anyone above, say clearly that you don't recognise them.`;
}
