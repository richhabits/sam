import { useState, useEffect } from "react";
import { getAdminConfig, saveKeys, saveConfig, getAllowed, setAllow, testEmail } from "./lib/api";

// Every publicly-available provider SAM can rotate across. `starter` = the easy, generous,
// grab-in-2-minutes ones shown first; the rest live under "More free brains". More keys
// across more providers = more free capacity (SAM hops when one's rate-limited).
type Prov = { id: string; label: string; note: string; url: string; starter?: boolean; premium?: boolean };
const PROVIDERS: Prov[] = [
  // ── Starter (do these first — fast, generous, easy) ──
  { id: "groq", label: "Groq", note: "⚡ fast chat — SAM's go-to for quick replies", url: "https://console.groq.com/keys", starter: true },
  { id: "cerebras", label: "Cerebras", note: "⚡ fast chat — blazing 70B, first pick", url: "https://cloud.cerebras.ai", starter: true },
  { id: "gemini", label: "Google Gemini", note: "👁 photos & vision — reads images; solid all-rounder", url: "https://aistudio.google.com/apikey", starter: true },
  { id: "openrouter", label: "OpenRouter", note: "🌐 many models behind one key — great backup", url: "https://openrouter.ai/keys", starter: true },
  { id: "nvidia", label: "NVIDIA", note: "🧠 reasoning — capable 70B for harder questions", url: "https://build.nvidia.com", starter: true },
  { id: "mistral", label: "Mistral", note: "✍️ writing & chat — solid European models", url: "https://console.mistral.ai/api-keys", starter: true },
  { id: "github", label: "GitHub Models", note: "💬 general chat — free with a GitHub token", url: "https://github.com/settings/tokens", starter: true },
  // ── More free brains (all public — stack as many as you like) ──
  { id: "together", label: "Together AI", note: "🧠 reasoning + 🎨 FREE images (FLUX)", url: "https://api.together.xyz/settings/api-keys" },
  { id: "deepseek", label: "DeepSeek", note: "🧠 deep reasoning + 💻 code — the heavy thinker", url: "https://platform.deepseek.com/api_keys" },
  { id: "sambanova", label: "SambaNova", note: "⚡ fast chat — very quick 70B", url: "https://cloud.sambanova.ai" },
  { id: "fireworks", label: "Fireworks", note: "💻 code + fast models", url: "https://fireworks.ai/account/api-keys" },
  { id: "cohere", label: "Cohere", note: "✍️ writing & search-style answers", url: "https://dashboard.cohere.com/api-keys" },
  { id: "hyperbolic", label: "Hyperbolic", note: "💬 general chat — open models", url: "https://app.hyperbolic.xyz/settings" },
  { id: "novita", label: "Novita", note: "🎬 VIDEO generation + chat (free credits)", url: "https://novita.ai/settings/key-management" },
  { id: "nebius", label: "Nebius", note: "💬 general chat — open models", url: "https://studio.nebius.com" },
  { id: "xai", label: "xAI (Grok)", note: "💬 general chat (Grok)", url: "https://console.x.ai" },
  { id: "huggingface", label: "HuggingFace", note: "🌐 many open models, one token", url: "https://huggingface.co/settings/tokens" },
  { id: "ai21", label: "AI21", note: "✍️ writing (Jamba)", url: "https://studio.ai21.com/account/api-key" },
  { id: "upstage", label: "Upstage", note: "💬 light quick chat (Solar)", url: "https://console.upstage.ai/api-keys" },
  { id: "perplexity", label: "Perplexity", note: "🔍 web-aware answers", url: "https://www.perplexity.ai/settings/api" },
  { id: "siliconflow", label: "SiliconFlow", note: "🎨 images + 🎬 video + chat (free tier)", url: "https://cloud.siliconflow.cn/account/ak" },
  { id: "alibaba", label: "Qwen (Alibaba)", note: "🧠 reasoning (Qwen) — strong thinker", url: "https://bailian.console.alibabacloud.com" },
  { id: "moonshot", label: "Moonshot (Kimi)", note: "📚 long documents (Kimi) — huge context", url: "https://platform.moonshot.ai/console/api-keys" },
  { id: "zhipu", label: "Zhipu GLM-5.2", note: "🧠💻 NEW flagship — 1M context, top coder (20M free tokens)", url: "https://open.bigmodel.cn" },
  { id: "minimax", label: "MiniMax", note: "💬 general chat", url: "https://platform.minimaxi.com" },
  { id: "stepfun", label: "StepFun", note: "💬 general chat", url: "https://platform.stepfun.com" },
  { id: "deepinfra", label: "DeepInfra", note: "🌐 many open models — good backup", url: "https://deepinfra.com/dash/api_keys" },
  { id: "scaleway", label: "Scaleway", note: "💬 general chat — EU-hosted", url: "https://console.scaleway.com" },
  { id: "chutes", label: "Chutes", note: "🌐 many models — decentralised", url: "https://chutes.ai" },
  { id: "friendli", label: "Friendli", note: "💬 general chat — fast serving", url: "https://suite.friendli.ai" },
  { id: "codestral", label: "Codestral (Mistral)", note: "💻 CODE specialist (Mistral) — free", url: "https://console.mistral.ai/codestral" },
  { id: "inference", label: "Inference.net", note: "💬 general chat — cheap & quick", url: "https://inference.net" },
  { id: "vercel", label: "Vercel AI Gateway", note: "🌐 100s of models · $5 free EVERY month", url: "https://vercel.com/ai-gateway" },
  { id: "ovh", label: "OVHcloud AI", note: "💬 general chat — EU-hosted free tier", url: "https://endpoints.ai.cloud.ovh.net" },
  { id: "gmi", label: "GMI Cloud", note: "🧠 DeepSeek/Llama/Qwen hosting", url: "https://console.gmicloud.ai" },
  { id: "fal", label: "fal (HappyHorse)", note: "🎬 #1 VIDEO model — HappyHorse w/ native audio (free credits)", url: "https://fal.ai/dashboard/keys" },
  // ── Premium (paid — only used if you pick "Best", never on free) ──
  { id: "anthropic", label: "Anthropic (Claude)", note: "👑 premium (paid) — best quality, only on 'Best'", url: "https://console.anthropic.com/settings/keys", premium: true },
  { id: "openai", label: "OpenAI", note: "👑 premium (paid) — only on 'Best'", url: "https://platform.openai.com/api-keys", premium: true },
];

export default function Admin({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<any>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [eleven, setEleven] = useState("");
  const [voice, setVoice] = useState("");
  const [saved, setSaved] = useState("");
  const [allowed, setAllowed] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [integrations, setIntegrations] = useState({ notion: "", slack: "", discord: "", twitter: "", linear: "", linearTeam: "" });
  const [email, setEmail] = useState({ smtpHost: "", smtpPort: "", smtpUser: "", smtpPass: "", smtpFrom: "", ownerEmail: "" });
  const [emailTest, setEmailTest] = useState("");
  const [apple, setApple] = useState({ appleId: "", appleTeam: "", applePass: "" });

  const refresh = () => {
    getAdminConfig().then((c) => {
      setCfg(c);
      setVoice(c.elevenVoice || "");
      setIntegrations((prev) => ({ ...prev, linearTeam: c.linearTeam || "" }));
      // hydrate the non-secret email fields (password is never returned — placeholder shows if set)
      if (c.email) setEmail({ smtpHost: c.email.smtpHost || "", smtpPort: c.email.smtpPort || "", smtpUser: c.email.smtpUser || "", smtpPass: "", smtpFrom: c.email.smtpFrom || "", ownerEmail: c.email.ownerEmail || "" });
      if (c.apple) setApple({ appleId: c.apple.appleId || "", appleTeam: c.apple.appleTeam || "", applePass: "" });
    }).catch(() => {});
    getAllowed().then((a) => setAllowed(a.allowed || [])).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);
  const count = (id: string) => cfg?.providers?.find((p: any) => p.id === id)?.keys ?? 0;
  const flash = (id: string) => { setSaved(id); setTimeout(() => setSaved(""), 1600); };

  async function saveProvider(id: string) {
    await saveKeys(id, drafts[id] || "");
    setDrafts((d) => ({ ...d, [id]: "" }));
    flash(id); refresh();
  }
  async function saveEleven() {
    if (eleven.trim()) await saveConfig("elevenlabs", eleven.trim());
    if (voice.trim()) await saveConfig("elevenVoice", voice.trim());
    setEleven(""); flash("elevenlabs"); refresh();
  }
  async function setService(v: string) { await saveConfig("musicService", v); refresh(); }

  async function saveEmail() {
    // Only send fields the user actually changed (blank password = keep the saved one).
    if (email.smtpHost) await saveConfig("smtpHost", email.smtpHost.trim());
    if (email.smtpPort) await saveConfig("smtpPort", email.smtpPort.trim());
    if (email.smtpUser) await saveConfig("smtpUser", email.smtpUser.trim());
    if (email.smtpPass) await saveConfig("smtpPass", email.smtpPass.trim());
    if (email.smtpFrom) await saveConfig("smtpFrom", email.smtpFrom.trim());
    if (email.ownerEmail) await saveConfig("ownerEmail", email.ownerEmail.trim());
    setEmail((e) => ({ ...e, smtpPass: "" }));
    flash("email"); refresh();
  }
  async function sendTest() {
    setEmailTest("Sending…");
    const r = await testEmail().catch(() => ({ ok: false, error: "request failed" }));
    setEmailTest(r.ok ? "Sent ✓ — check your inbox" : `Failed: ${r.error || "unknown"}`);
    setTimeout(() => setEmailTest(""), 6000);
  }

  async function saveIntegrations() {
    if (integrations.notion) await saveConfig("notion", integrations.notion.trim());
    if (integrations.slack) await saveConfig("slack", integrations.slack.trim());
    if (integrations.discord) await saveConfig("discord", integrations.discord.trim());
    if (integrations.twitter) await saveConfig("twitter", integrations.twitter.trim());
    if (integrations.linear) await saveConfig("linear", integrations.linear.trim());
    if (integrations.linearTeam) await saveConfig("linearTeam", integrations.linearTeam.trim());
    setIntegrations({ notion: "", slack: "", discord: "", twitter: "", linear: "", linearTeam: integrations.linearTeam });
    flash("integrations");
    refresh();
  }

  const totalKeys = (cfg?.providers || []).reduce((a: number, p: any) => a + p.keys, 0);

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer admin" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">API keys &amp; providers</div>
            <div className="drawer-sub">Paste your free keys — SAM rotates through them so you never hit a limit. Add as many as you like (comma or new line). {totalKeys} loaded.</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {(() => {
          const row = (p: Prov) => (
            <div key={p.id} className="admin-row">
              <div className="admin-h"><span className="admin-name">{p.label}</span><span className="admin-note">{p.note}</span><span className="admin-count">{count(p.id)} key{count(p.id) === 1 ? "" : "s"}</span></div>
              <textarea className="admin-input" rows={2} placeholder={`Paste ${p.label} key(s) — comma or new line for many`}
                value={drafts[p.id] || ""} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))} />
              <div className="admin-actions">
                <button className="admin-save" onClick={() => saveProvider(p.id)}>{saved === p.id ? "Saved ✓" : "Save keys"}</button>
                <a className="admin-getkey" href={p.url} target="_blank" rel="noopener noreferrer">{p.premium ? "Get a key ↗" : "Get a FREE key ↗"}</a>
              </div>
            </div>
          );
          const starters = PROVIDERS.filter((p) => p.starter);
          const moreFree = PROVIDERS.filter((p) => !p.starter && !p.premium);
          const premium = PROVIDERS.filter((p) => p.premium);
          const activeKeys = PROVIDERS.reduce((n, p) => n + (count(p.id) > 0 ? 1 : 0), 0);
          // Media matrix — what each ability runs on NOW, and which key switches it on.
          const has = (id: string) => count(id) > 0;
          const ABILITIES = [
            { icon: "💬", label: "Chat", on: true, via: activeKeys ? `${activeKeys} free brains, rotating` : "free no-key brain + Ollama", up: activeKeys ? "" : "add Groq/Cerebras for speed" },
            { icon: "🎨", label: "Images", on: true, via: has("together") || has("siliconflow") ? "unlimited + free-credit lanes" : "Pollinations — unlimited, no key", up: has("together") || has("siliconflow") ? "" : "add Together for FLUX quality" },
            { icon: "🔊", label: "Voice", on: true, via: cfg?.elevenlabs ? "ElevenLabs premium" : has("groq") ? "Groq TTS (free)" : "free voice, no key", up: cfg?.elevenlabs ? "" : "add ElevenLabs for premium voice" },
            { icon: "👁", label: "Photo reading", on: has("gemini"), via: has("gemini") ? "Gemini (free)" : "", up: has("gemini") ? "" : "add a free Gemini key (or run Ollama + llava)" },
            { icon: "🎧", label: "Transcription", on: has("groq"), via: has("groq") ? "Groq Whisper (free)" : "", up: has("groq") ? "" : "add a free Groq key" },
            { icon: "🎬", label: "Video", on: has("fal") || has("novita") || has("siliconflow"), via: has("fal") ? "HappyHorse #1 (fal)" : has("novita") ? "Novita credits" : has("siliconflow") ? "SiliconFlow credits" : "", up: has("fal") ? "" : "add fal (HappyHorse!) / Novita / SiliconFlow" },
          ];
          return (
            <>
              <div className="admin-matrix">
                {ABILITIES.map((a) => (
                  <div key={a.label} className={"matrix-cell" + (a.on ? " on" : "")}>
                    <span className="matrix-ic">{a.icon}</span>
                    <span className="matrix-name">{a.label}</span>
                    <span className="matrix-via">{a.on ? `✓ ${a.via}` : "off"}{a.up ? ` · ${a.up}` : ""}</span>
                  </div>
                ))}
              </div>
              <div className="admin-lead">🆓 <b>All free.</b> Grab a key from as many as you like — SAM spreads work across them all (sipping each lightly so your free quotas last), and hops on when one's busy. {activeKeys > 0 ? `You've got ${activeKeys} provider${activeKeys === 1 ? "" : "s"} connected.` : "Start with one — 2 minutes."} <span style={{ opacity: .8 }}>Even with zero keys, SAM falls back to a no-key free brain + local Ollama — so it never goes dark.</span></div>
              {starters.map(row)}
              <button className="admin-more" onClick={() => setShowMore((v) => !v)}>
                {showMore ? "▾ Hide extra free brains" : `▸ ＋ ${moreFree.length} more FREE brains — stack them for more free capacity`}
              </button>
              {showMore && moreFree.map(row)}
              <div className="admin-sub">Premium (paid — optional, only used if you pick “Best”)</div>
              {premium.map(row)}
            </>
          );
        })()}

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">ElevenLabs voice</span><span className="admin-note">premium voice</span><span className="admin-count">{cfg?.elevenlabs ? "on" : "off"}</span></div>
          <input className="admin-input" placeholder="ElevenLabs API key" value={eleven} onChange={(e) => setEleven(e.target.value)} />
          <input className="admin-input" placeholder="Voice ID (default: Rachel)" value={voice} onChange={(e) => setVoice(e.target.value)} />
          <button className="admin-save" onClick={saveEleven}>{saved === "elevenlabs" ? "Saved ✓" : "Save voice"}</button>
        </div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">Music service</span><span className="admin-note">where “play” opens tracks</span></div>
          <div className="admin-seg">
            {["apple", "spotify", "youtube"].map((s) => (
              <button key={s} className={cfg?.musicService === s ? "on" : ""} onClick={() => setService(s)}>{s}</button>
            ))}
          </div>
        </div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">3rd-Party Integrations</span><span className="admin-note">keys for Notion, Slack, etc.</span></div>
          <div style={{display:"flex", gap: 8, flexDirection:"column", marginTop:12}}>
            <input className="admin-input" placeholder={`Notion API Key ${cfg?.notion ? "(Saved)" : ""}`} value={integrations.notion} onChange={(e) => setIntegrations(i => ({...i, notion: e.target.value}))} />
            <input className="admin-input" placeholder={`Slack Bot Token ${cfg?.slack ? "(Saved)" : ""}`} value={integrations.slack} onChange={(e) => setIntegrations(i => ({...i, slack: e.target.value}))} />
            <input className="admin-input" placeholder={`Discord Webhook URL ${cfg?.discord ? "(Saved)" : ""}`} value={integrations.discord} onChange={(e) => setIntegrations(i => ({...i, discord: e.target.value}))} />
            <input className="admin-input" placeholder={`X (Twitter) Bearer Token ${cfg?.twitter ? "(Saved)" : ""}`} value={integrations.twitter} onChange={(e) => setIntegrations(i => ({...i, twitter: e.target.value}))} />
            <input className="admin-input" placeholder={`Linear API Key ${cfg?.linear ? "(Saved)" : ""}`} value={integrations.linear} onChange={(e) => setIntegrations(i => ({...i, linear: e.target.value}))} />
            <input className="admin-input" placeholder="Linear Team ID" value={integrations.linearTeam} onChange={(e) => setIntegrations(i => ({...i, linearTeam: e.target.value}))} />
            <button className="admin-save" onClick={saveIntegrations} style={{width:"auto", alignSelf:"flex-start"}}>{saved === "integrations" ? "Saved ✓" : "Save Integrations"}</button>
          </div>
        </div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">📧 SAM's email {cfg?.email?.configured ? "· on" : ""}</span><span className="admin-note">so SAM can email your brief + nudges, and send on its own</span></div>
          <div style={{ display: "flex", gap: 8, flexDirection: "column", marginTop: 12 }}>
            <input className="admin-input" placeholder="SMTP host (e.g. smtp.gmail.com)" value={email.smtpHost} onChange={(e) => setEmail(v => ({ ...v, smtpHost: e.target.value }))} />
            <div style={{ display: "flex", gap: 8 }}>
              <input className="admin-input" style={{ width: 110 }} placeholder="Port (587)" value={email.smtpPort} onChange={(e) => setEmail(v => ({ ...v, smtpPort: e.target.value }))} />
              <input className="admin-input" style={{ flex: 1 }} placeholder="Username (SAM's address)" value={email.smtpUser} onChange={(e) => setEmail(v => ({ ...v, smtpUser: e.target.value }))} />
            </div>
            <input className="admin-input" type="password" placeholder={cfg?.email?.smtpPassSet ? "App password (saved — leave blank to keep)" : "App password"} value={email.smtpPass} onChange={(e) => setEmail(v => ({ ...v, smtpPass: e.target.value }))} />
            <input className="admin-input" placeholder='From (e.g. SAM <sam@you.com>) — optional' value={email.smtpFrom} onChange={(e) => setEmail(v => ({ ...v, smtpFrom: e.target.value }))} />
            <input className="admin-input" placeholder="Send my brief to (your inbox)" value={email.ownerEmail} onChange={(e) => setEmail(v => ({ ...v, ownerEmail: e.target.value }))} />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="admin-save" onClick={saveEmail} style={{ width: "auto" }}>{saved === "email" ? "Saved ✓" : "Save email"}</button>
              <button className="admin-save" onClick={sendTest} style={{ width: "auto", opacity: cfg?.email?.configured ? 1 : 0.5 }} disabled={!cfg?.email?.configured}>Send test</button>
              {emailTest && <span className="admin-note" style={{ marginLeft: 4 }}>{emailTest}</span>}
            </div>
            <div className="admin-foot">Gmail: create an <b>App password</b> (not your login). IONOS/Fastmail/any SMTP works. Port 465 = TLS, 587 = STARTTLS.</div>
          </div>
        </div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">🍎 Signed releases {cfg?.apple?.appleId ? "· on" : ""}</span><span className="admin-note">owner only — sign the Mac app so it opens clean + auto-updates itself</span></div>
          <div style={{ display: "flex", gap: 8, flexDirection: "column", marginTop: 12 }}>
            <input className="admin-input" placeholder="Apple ID email (developer account)" value={apple.appleId} onChange={(e) => setApple(v => ({ ...v, appleId: e.target.value }))} />
            <div style={{ display: "flex", gap: 8 }}>
              <input className="admin-input" style={{ width: 160 }} placeholder="Team ID (ABCDE12345)" value={apple.appleTeam} onChange={(e) => setApple(v => ({ ...v, appleTeam: e.target.value }))} />
              <input className="admin-input" type="password" style={{ flex: 1 }} placeholder={cfg?.apple?.applePassSet ? "App-specific password (saved — blank keeps it)" : "App-specific password (appleid.apple.com)"} value={apple.applePass} onChange={(e) => setApple(v => ({ ...v, applePass: e.target.value }))} />
            </div>
            <button className="admin-save" style={{ width: "auto", alignSelf: "flex-start" }} onClick={async () => {
              if (apple.appleId) await saveConfig("appleId", apple.appleId.trim());
              if (apple.appleTeam) await saveConfig("appleTeam", apple.appleTeam.trim());
              if (apple.applePass) await saveConfig("applePass", apple.applePass.trim());
              setApple((v) => ({ ...v, applePass: "" })); flash("apple"); refresh();
            }}>{saved === "apple" ? "Saved ✓" : "Save Apple setup"}</button>
            <div className="admin-foot">One-time: create a <b>Developer ID Application</b> certificate in Xcode (Settings → Accounts → Manage Certificates), then release with <code>npm run release:app</code> — installed SAMs silently self-update from then on.</div>
          </div>
        </div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">Authorized actions</span><span className="admin-note">SAM does these without asking</span></div>
          {allowed.length === 0
            ? <div className="admin-foot">None yet. When SAM asks approval, tap <b>Always allow</b> to authorise that action for good.</div>
            : <ul className="allow-list">{allowed.map((t) => (
                <li key={t}><span>{t.replace(/_/g, " ")}</span><button onClick={async () => { await setAllow(t, false); refresh(); }}>Revoke</button></li>
              ))}</ul>}
        </div>

        <div className="admin-foot">Keys are stored only on this computer (your .env). SAM never shows them back.</div>
      </aside>
    </div>
  );
}
