import os from "node:os";
import type { Express } from "express";
import { writeEnv } from "./env-file.ts";
import { isLoopback } from "./http-guards.ts";
import { MCP_PRESETS, presetById } from "./mcp-presets.ts";
import { addPerson, faceRoster, listPeople } from "./people.ts";
import { addSubscription, subscriberCount, vapidPublicKey } from "./push.ts";
import { logSecurity } from "./security.ts";
import { generateAndroidKeystore, signingStatus } from "./signing.ts";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// PEOPLE SAM knows by sight, push subscriptions, MCP presets and Android signing.
//
// `port` is INJECTED rather than read from a shared module: it is needed once, to build the
// LAN URL shown for phone access. Passing it keeps index.ts the single place the port is
// decided, instead of two modules independently reading process.env.PORT and disagreeing.
export function registerPeopleRoutes(app: Express, port: string | number) {
  // ── People SAM knows by sight (local, private) ──
  app.get("/api/people", (_req, res) => res.json(listPeople()));
  app.post("/api/people", (req, res) => { const { name, look, relation, face } = req.body || {}; if (!name) return res.status(400).json({ error: "name required" }); res.json(addPerson(name, look || "", relation, Array.isArray(face) ? face : undefined)); });
  // Face descriptors (128-float vectors, computed on-device) the HUD matches against — no images.
  app.get("/api/faces", (_req, res) => res.json({ faces: faceRoster() }));

  // 🔌 MCP presets — one-tap connect to business tools (Stripe, RevenueCat, Metricool, Meta Ads…).
  // Config (with keys) is loopback-only; keys are written to vault/mcp.json (gitignored) and NEVER
  // returned by the API. Takes effect on the next restart (MCP servers load at boot).
  const MCP_CONFIG = join(process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault"), "mcp.json");
  function readMcpConfig(): { servers: any[] } { try { const c = JSON.parse(readFileSync(MCP_CONFIG, "utf8")); return { servers: Array.isArray(c?.servers) ? c.servers : [] }; } catch { return { servers: [] }; } }
  function writeMcpConfig(cfg: { servers: any[] }) { mkdirSync(dirname(MCP_CONFIG), { recursive: true }); writeFileSync(MCP_CONFIG, JSON.stringify(cfg, null, 2)); }
  app.get("/api/mcp/presets", (_req, res) => {
    const configured = new Set(readMcpConfig().servers.map((s: any) => s?.name));
    // never leak env VALUES — only the catalog + which ids are connected
    res.json({ presets: MCP_PRESETS.map((p) => ({ id: p.id, label: p.label, emoji: p.emoji, note: p.note, official: p.official, fields: p.fields, docs: p.docs, connected: configured.has(p.id) })) });
  });
  app.post("/api/mcp/configure", (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "configure MCP on this computer only" });
    const { id, env } = req.body || {};
    const preset = presetById(String(id || ""));
    if (!preset) return res.status(400).json({ error: "unknown preset" });
    if (!env || typeof env !== "object" || preset.fields.some((f) => !String(env[f.env] || "").trim())) return res.status(400).json({ error: "missing key(s)" });
    const cleanEnv: Record<string, string> = {};
    for (const f of preset.fields) cleanEnv[f.env] = String(env[f.env]).trim();
    const cfg = readMcpConfig();
    const server = { name: preset.id, command: preset.command, args: preset.args, env: cleanEnv };
    const i = cfg.servers.findIndex((s: any) => s?.name === preset.id);
    if (i >= 0) cfg.servers[i] = server; else cfg.servers.push(server);
    writeMcpConfig(cfg);
    res.json({ ok: true, needsRestart: true });
  });
  app.post("/api/mcp/remove", (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
    const id = String(req.body?.id || "");
    const cfg = readMcpConfig();
    const before = cfg.servers.length;
    cfg.servers = cfg.servers.filter((s: any) => s?.name !== id);
    writeMcpConfig(cfg);
    res.json({ ok: cfg.servers.length < before, needsRestart: true });
  });

  // 🔔 Web Push — SAM reaches your phone even when the app is closed.
  app.get("/api/push/key", (_req, res) => res.json({ key: vapidPublicKey(), subscribers: subscriberCount() }));
  app.post("/api/push/subscribe", (req, res) => { const ok = addSubscription(req.body); res.json({ ok }); });


  // 📱 Phone link — loopback-only. Returns the scan-me URL (with token) so Settings can show a
  // QR the phone camera reads → lands authenticated. Only reveals the token to a local request.
  function lanIP(): string | null {
    const nets = os.networkInterfaces();
    const n = Object.values(nets).flat().find((x) => x && x.family === "IPv4" && !x.internal);
    return n?.address || null;
  }
  app.get("/api/phone-link", (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
    const remoteOn = process.env.SAM_REMOTE === "1" && (process.env.SAM_REMOTE_TOKEN || "").length >= 16;
    const lan = lanIP();
    const url = remoteOn && lan ? `http://${lan}:${port}/?token=${encodeURIComponent(process.env.SAM_REMOTE_TOKEN!)}` : null;
    res.json({ remoteOn, lan, url });
  });
  // One-click enable: generate a strong token, persist SAM_REMOTE=1 + token (takes effect on restart).
  app.post("/api/phone-enable", (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
    const token = randomBytes(32).toString("base64url");   // 256-bit — quantum-safe symmetric secret (128-bit effective under Grover)
    writeEnv("SAM_REMOTE", "1");
    writeEnv("SAM_REMOTE_TOKEN", token);
    process.env.SAM_REMOTE = "1"; process.env.SAM_REMOTE_TOKEN = token;
    res.json({ ok: true, needsRestart: true });
  });
  // 🔁 Rotate the token — instantly revokes every device (they must re-scan). No restart needed; the
  // gate reads SAM_REMOTE_TOKEN live. Loopback-only so a remote device can never rotate you out.
  app.post("/api/phone-regenerate", (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
    const token = randomBytes(32).toString("base64url");   // 256-bit, quantum-safe
    writeEnv("SAM_REMOTE_TOKEN", token);
    process.env.SAM_REMOTE_TOKEN = token;
    logSecurity("info", "phone-token-rotated", "Phone access token regenerated — all devices must re-connect", "owner");
    res.json({ ok: true, rotated: true });
  });
  // 🔴 Turn phone access OFF — closes the LAN entirely (binds back to loopback on next restart) and
  // invalidates the token now.
  // 🚀 Sign & ship — SAM checks your signing readiness and does the mechanical bits (owner-only).
  app.get("/api/signing/status", async (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
    try { res.json(await signingStatus()); } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.post("/api/signing/android-keystore", async (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
    res.json(await generateAndroidKeystore());
  });

  app.post("/api/phone-disable", (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
    writeEnv("SAM_REMOTE", "0");
    process.env.SAM_REMOTE = "0";
    logSecurity("info", "phone-disabled", "Phone/remote access turned off", "owner");
    res.json({ ok: true, needsRestart: true });
  });

  // 📸 Save a camera snapshot into the vault (local only — vault/photos is gitignored).
  app.post("/api/photo", (req, res) => {
    try {
      const data = String(req.body?.data || "");
      const b64 = data.replace(/^data:image\/\w+;base64,/, "");
      if (!b64 || b64.length > 14_000_000) return res.status(400).json({ error: "no/oversized image" });
      const dir = join(process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault"), "photos");
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
      const file = join(dir, `photo-${stamp}.jpg`);
      writeFileSync(file, Buffer.from(b64, "base64"));
      res.json({ ok: true, path: file });
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e).slice(0, 120) }); }
  });
}
