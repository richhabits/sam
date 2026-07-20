import type { Express } from "express";
import { writeEnv } from "./env-file.ts";
import { isElonMode, setElonMode } from "./authz.ts";
import { isLoopback } from "./http-guards.ts";
import { extractFactsFromTranscript, saveImportedFacts } from "./importer.ts";
import { keyStatus, poolSize, setPool } from "./keys.ts";
import { mailerConfigured, ownerEmail, resetMailer, sendMail } from "./mailer.ts";
import { GATEWAY_URL, deviceId, type Tier } from "./models.ts";
import { PROVIDER_ENV as REGISTRY_ENV, uiCatalogue } from "./providers.registry.ts";

// ADMIN — manage API keys & config from inside the app. Every write here is loopback-gated:
// these endpoints write credentials to .env, so a remote device (a phone on the shared token)
// must never reach them. Extracted from index.ts; paths and registration order unchanged.
export function registerAdminRoutes(app: Express) {
  // ── ADMIN · manage API keys & config from inside the app ─────
  // Providers → their .env variable. Rolling pools accept many keys (comma list).
  // Derived from PROVIDER_REGISTRY, in full — no special cases left. What Settings offers is
  // exactly what this endpoint can save, because both read the same array.
  const PROVIDER_ENV: Record<string, string> = REGISTRY_ENV;
  const CONFIG_ENV: Record<string, string> = {
    cloudflareAccount: "CLOUDFLARE_ACCOUNT_ID", cloudflareToken: "CLOUDFLARE_API_TOKEN", leonardo: "LEONARDO_API_KEY",
    pexels: "PEXELS_API_KEY", pixabay: "PIXABAY_API_KEY", giphy: "GIPHY_API_KEY", tmdb: "TMDB_API_KEY", omdb: "OMDB_API_KEY",
    obsidianVault: "OBSIDIAN_VAULT",
    elevenlabs: "ELEVENLABS_API_KEY", elevenVoice: "ELEVENLABS_VOICE_ID",
    defaultTier: "DEFAULT_TIER", musicService: "MUSIC_SERVICE",
    groqModel: "GROQ_MODEL", claudeModel: "CLAUDE_MODEL",
    notion: "NOTION_API_KEY", slack: "SLACK_BOT_TOKEN",
    discord: "DISCORD_WEBHOOK_URL", twitter: "TWITTER_BEARER_TOKEN", slackChannel: "SLACK_CHANNEL",
    linear: "LINEAR_API_KEY", linearTeam: "LINEAR_TEAM_ID",
    // SAM's own email (SMTP) — set from Settings, saved to .env
    smtpHost: "SMTP_HOST", smtpPort: "SMTP_PORT", smtpUser: "SMTP_USER",
    smtpPass: "SMTP_PASS", smtpFrom: "SMTP_FROM", ownerEmail: "SAM_OWNER_EMAIL",
    // Apple signed releases (owner-only, BUILD-time creds — used by npm run release:app)
    appleId: "APPLE_ID", appleTeam: "APPLE_TEAM_ID", applePass: "APPLE_APP_SPECIFIC_PASSWORD",
  };
  // Status only — never returns key VALUES, just how many are set.
  app.get("/api/admin/config", (_req, res) => {
    const pools = keyStatus();
    res.json({
      // Full descriptors, not just ids: the Settings UI renders from THIS, so there is no second
      // provider list in src/ to drift. Env var names never leave the server.
      providers: uiCatalogue().map((p) => ({ ...p, keys: poolSize(p.id) })),
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      elevenVoice: process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
      defaultTier: process.env.DEFAULT_TIER || "free",
      musicService: process.env.MUSIC_SERVICE || "apple",
      notion: !!process.env.NOTION_API_KEY,
      slack: !!process.env.SLACK_BOT_TOKEN,
      discord: !!process.env.DISCORD_WEBHOOK_URL,
      twitter: !!process.env.TWITTER_BEARER_TOKEN,
      linear: !!process.env.LINEAR_API_KEY,
      linearTeam: process.env.LINEAR_TEAM_ID || "",
      // Apple signing (owner) — non-secret fields + whether the app-specific password is set
      media: { pexels: !!process.env.PEXELS_API_KEY, pixabay: !!process.env.PIXABAY_API_KEY, giphy: !!process.env.GIPHY_API_KEY, tmdb: !!process.env.TMDB_API_KEY, omdb: !!process.env.OMDB_API_KEY },
      apple: {
        appleId: process.env.APPLE_ID || "",
        appleTeam: process.env.APPLE_TEAM_ID || "",
        applePassSet: !!process.env.APPLE_APP_SPECIFIC_PASSWORD,
      },
      // SAM email — non-secret fields + whether a password is set (never the password itself)
      email: {
        configured: mailerConfigured(),
        smtpHost: process.env.SMTP_HOST || "",
        smtpPort: process.env.SMTP_PORT || "",
        smtpUser: process.env.SMTP_USER || "",
        smtpFrom: process.env.SMTP_FROM || "",
        ownerEmail: process.env.SAM_OWNER_EMAIL || "",
        smtpPassSet: !!process.env.SMTP_PASS,
      },
      elonMode: isElonMode(),
      pools,
    });
  });

  // Live-validate a key by making one cheap test call to the provider. The key is used + discarded
  // (never logged, never stored here) — only saved if the user then hits Save.
  const testGet = (url: string, key: string) => fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false);
  const KEY_TEST: Record<string, (k: string) => Promise<boolean>> = {
    groq: (k) => testGet("https://api.groq.com/openai/v1/models", k),
    gemini: (k) => fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false),
    openrouter: (k) => testGet("https://openrouter.ai/api/v1/models", k),
    mistral: (k) => testGet("https://api.mistral.ai/v1/models", k),
    nvidia: (k) => testGet("https://integrate.api.nvidia.com/v1/models", k),
    cerebras: (k) => testGet("https://api.cerebras.ai/v1/models", k),
    together: (k) => testGet("https://api.together.xyz/v1/models", k),
  };
  app.post("/api/admin/validate-key", async (req, res) => {
    const { provider, key } = (req.body || {}) as { provider?: string; key?: string };
    if (!provider || !key) return res.json({ valid: false });
    const tester = KEY_TEST[provider];
    if (!tester) return res.json({ valid: null });   // can't test this one — save it and it rotates in
    try { res.json({ valid: await tester(String(key).trim()) }); } catch { res.json({ valid: false }); }
  });

  // SAM Cloud gateway quota (only meaningful if SAM_GATEWAY_URL is set at build) — the UI shows the
  // remaining daily free allowance + nudges the user to add their own key for unlimited use.
  app.get("/api/gateway/quota", async (_req, res) => {
    if (!GATEWAY_URL) return res.json({ enabled: false });
    try {
      const r = await fetch(`${GATEWAY_URL}/v1/quota?device=${encodeURIComponent(deviceId())}`, { signal: AbortSignal.timeout(6000) });
      res.json({ enabled: true, ...(await r.json()) });
    } catch { res.json({ enabled: true, error: "unreachable" }); }
  });

  // Save keys for a provider (rolling pool — send an array or comma/newline text).
  app.post("/api/admin/keys", (req, res) => {
    // Loopback-only, like standing authorizations / autopilot / remote tokens. Writing keys is a
    // CREDENTIAL change: it decides which accounts SAM spends and who it talks to. Every other
    // privileged write here is already "this computer only"; these two were the exception.
    if (!isLoopback(req)) return res.status(403).json({ error: "API keys can only be changed on this computer, not remotely." });
    const { provider, keys } = req.body as { provider: string; keys: string | string[] };
    const envVar = PROVIDER_ENV[provider];
    if (!envVar) return res.status(400).json({ error: "unknown provider" });
    const list = (Array.isArray(keys) ? keys : String(keys || "").split(/[\n,]/)).map((k) => k.trim()).filter(Boolean);
    writeEnv(envVar, list.join(","));
    const count = setPool(provider, list);
    res.json({ ok: true, provider, keys: count });
  });

  // Save a config value (elevenlabs key, voice, default tier, music service…).
  app.post("/api/admin/config", (req, res) => {
    // Same reasoning, and sharper: CONFIG_ENV can write the Slack bot token, Discord webhook,
    // Notion/Linear keys and Cloudflare token — so a remote token-holder could REDIRECT SAM's
    // outbound integrations at their own endpoints. That is a local-only decision.
    if (!isLoopback(req)) return res.status(403).json({ error: "Integration keys can only be changed on this computer, not remotely." });
    const { key, value } = req.body as { key: string; value: string };
    const envVar = CONFIG_ENV[key];
    if (!envVar) return res.status(400).json({ error: "unknown config key" });
    writeEnv(envVar, String(value || ""));
    if (envVar.startsWith("SMTP_") || envVar === "SAM_OWNER_EMAIL") resetMailer();   // pick up the new email config
    res.json({ ok: true, key });
  });

  // Send a test email to confirm SAM's email is wired up.
  app.post("/api/admin/test-email", async (_req, res) => {
    const r = await sendMail(ownerEmail(), "✅ SAM email test", "This is SAM — your email is set up. I can now send your morning brief and nudges here.");
    res.json(r);
  });

  // Ingest user context (pasted from ChatGPT/Claude/Gemini) during onboarding or settings updates.
  app.post("/api/admin/import-context", async (req, res) => {
    const { name, externalContext, tier } = req.body as { name: string; externalContext?: string; tier?: Tier };
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    try {
      const contextText = externalContext || "";
      if (contextText.trim().length > 0) {
        const chosenTier = tier || (process.env.DEFAULT_TIER as Tier) || "free";
        const facts = await extractFactsFromTranscript(name, contextText, chosenTier);
        const savedCount = await saveImportedFacts(facts);
        res.json({ ok: true, factsExtracted: facts.length, factsSaved: savedCount });
      } else {
        res.json({ ok: true, factsExtracted: 0, factsSaved: 0 });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to process import" });
    }
  });

  // Toggle Elon Mode (ruthless automation override).
  app.post("/api/admin/elon-mode", (req, res) => {
    // Elon Mode bypasses EVERY ask-first safety gate — never flippable from a remote device
    // (a phone with the shared token). Only the owner, at the machine itself, can enable it.
    if (!isLoopback(req)) return res.status(403).json({ error: "Elon Mode can only be toggled on this computer, not remotely." });
    const { on } = req.body as { on: boolean };
    setElonMode(on);
    res.json({ ok: true, elonMode: isElonMode() });
  });
}
