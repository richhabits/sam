// ─────────────────────────────────────────────────────────────
//  S.A.M. · MEMORY DASHBOARD ROUTES — "What SAM remembers about you."
//
//  First slice of splitting server/index.ts (1770 lines, 131 routes — audit finding #2). This
//  domain was chosen because it is genuinely self-contained: its routes close over NO
//  index.ts-local state, only imports from memory.ts. Sections like ADMIN (8 shared identifiers)
//  and the MAIN COMMAND LOOP (11) would need state threading and are NOT cheap in the same way —
//  see docs/DESIGN-AUDIT.md for the per-section coupling table before extracting the next one.
//
//  Pattern, deliberately boring: a register function that takes the app, so route PATHS and
//  registration ORDER are unchanged. A Router with a mount point would have moved the paths.
//
//  100% on-device (SQLite); nothing here ever leaves the machine.
// ─────────────────────────────────────────────────────────────
import type { Express } from "express";
import { listAll, forget, clearUser } from "./memory.ts";

export function registerMemoryRoutes(app: Express): void {
  app.get("/api/memory", (req, res) => {
    const name = (String(req.query.user || "").trim() || process.env.SAM_USER_NAME || "").trim() || undefined;
    const items = listAll(name);
    const groups: Record<string, { id: string; text: string; ts: number }[]> = { fact: [], plan: [], decision: [], task: [] };
    for (const it of items) { groups[it.kind] ||= []; groups[it.kind].push({ id: it.id, text: it.text, ts: it.ts }); }
    res.json({ groups, count: items.length, private: true, note: "All local — nothing left your device." });
  });
  app.post("/api/memory/forget", (req, res) => {
    const id = String(req.body?.id || "");
    res.json({ ok: id ? forget(id) : false });
  });
  // Export this user's memory as a downloadable Markdown file — 100% local, nothing leaves the device.
  app.get("/api/memory/export", (req, res) => {
    const name = (String(req.query.user || "").trim() || process.env.SAM_USER_NAME || "").trim() || undefined;
    const items = listAll(name);
    const groups: Record<string, { text: string; ts: number }[]> = { fact: [], plan: [], decision: [], task: [] };
    for (const it of items) { groups[it.kind] ||= []; groups[it.kind].push({ text: it.text, ts: it.ts }); }
    const section = (title: string, rows: { text: string; ts: number }[]) =>
      `## ${title}\n\n` + (rows.length ? rows.map((r) => `- ${r.text}  _(${new Date(r.ts).toISOString().slice(0, 10)})_`).join("\n") : "_(none)_") + "\n";
    const markdown = `# What SAM remembers about you\n\n_${items.length} memories · exported ${new Date().toISOString().slice(0, 10)} · all local_\n\n`
      + section("Facts", groups.fact) + "\n" + section("Plans", groups.plan) + "\n"
      + section("Decisions", groups.decision) + "\n" + section("Open loops", groups.task);
    res.json({ markdown });
  });
  // Wipe this user's memory (scoped delete). Returns how many were cleared.
  app.post("/api/memory/clear", (req, res) => {
    const name = (String(req.body?.user || "").trim() || process.env.SAM_USER_NAME || "").trim() || undefined;
    const cleared = clearUser(name);
    res.json({ ok: true, cleared });
  });
}
