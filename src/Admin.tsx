import { useState, useEffect } from "react";
import { getAdminConfig, saveKeys, saveConfig, getAllowed, setAllow, testEmail } from "./lib/api";

// Every publicly-available provider SAM can rotate across. `starter` = the easy, generous,
// grab-in-2-minutes ones shown first; the rest live under "More free brains". More keys
// across more providers = more free capacity (SAM hops when one's rate-limited).
type Prov = { id: string; label: string; note: string; url: string; starter?: boolean; premium?: boolean };
const PROVIDERS: Prov[] = [
  // ── Starter (do these first — fast, generous, easy) ──
  { id: "groq", label: "Groq", note: "fastest · very generous free tier", url: "https://console.groq.com/keys", starter: true },
  { id: "cerebras", label: "Cerebras", note: "blazing fast · big 70B", url: "https://cloud.cerebras.ai", starter: true },
  { id: "gemini", label: "Google Gemini", note: "adds photos/vision · generous", url: "https://aistudio.google.com/apikey", starter: true },
  { id: "openrouter", label: "OpenRouter", note: "many free models, one key", url: "https://openrouter.ai/keys", starter: true },
  { id: "nvidia", label: "NVIDIA", note: "capable 70B · generous", url: "https://build.nvidia.com", starter: true },
  { id: "mistral", label: "Mistral", note: "solid European models · free tier", url: "https://console.mistral.ai/api-keys", starter: true },
  { id: "github", label: "GitHub Models", note: "free with a GitHub token", url: "https://github.com/settings/tokens", starter: true },
  // ── More free brains (all public — stack as many as you like) ──
  { id: "together", label: "Together AI", note: "free credits · many models", url: "https://api.together.xyz/settings/api-keys" },
  { id: "deepseek", label: "DeepSeek", note: "strong reasoning & code", url: "https://platform.deepseek.com/api_keys" },
  { id: "sambanova", label: "SambaNova", note: "very fast", url: "https://cloud.sambanova.ai" },
  { id: "fireworks", label: "Fireworks", note: "fast · free credits", url: "https://fireworks.ai/account/api-keys" },
  { id: "cohere", label: "Cohere", note: "free trial keys", url: "https://dashboard.cohere.com/api-keys" },
  { id: "hyperbolic", label: "Hyperbolic", note: "free credits", url: "https://app.hyperbolic.xyz/settings" },
  { id: "novita", label: "Novita", note: "free credits", url: "https://novita.ai/settings/key-management" },
  { id: "nebius", label: "Nebius", note: "free credits", url: "https://studio.nebius.com" },
  { id: "xai", label: "xAI (Grok)", note: "free credits", url: "https://console.x.ai" },
  { id: "huggingface", label: "HuggingFace", note: "free inference API", url: "https://huggingface.co/settings/tokens" },
  { id: "ai21", label: "AI21", note: "free trial", url: "https://studio.ai21.com/account/api-key" },
  { id: "upstage", label: "Upstage", note: "free credits", url: "https://console.upstage.ai/api-keys" },
  { id: "perplexity", label: "Perplexity", note: "free credits · web-aware", url: "https://www.perplexity.ai/settings/api" },
  { id: "siliconflow", label: "SiliconFlow", note: "free tier", url: "https://cloud.siliconflow.cn/account/ak" },
  { id: "alibaba", label: "Qwen (Alibaba)", note: "free tier · capable", url: "https://bailian.console.alibabacloud.com" },
  { id: "moonshot", label: "Moonshot (Kimi)", note: "free credits · long context", url: "https://platform.moonshot.ai/console/api-keys" },
  { id: "zhipu", label: "Zhipu (GLM)", note: "free tier", url: "https://open.bigmodel.cn" },
  { id: "minimax", label: "MiniMax", note: "free credits", url: "https://platform.minimaxi.com" },
  { id: "stepfun", label: "StepFun", note: "free tier", url: "https://platform.stepfun.com" },
  { id: "deepinfra", label: "DeepInfra", note: "free credits · many models", url: "https://deepinfra.com/dash/api_keys" },
  { id: "scaleway", label: "Scaleway", note: "free beta · EU", url: "https://console.scaleway.com" },
  { id: "chutes", label: "Chutes", note: "free tier · decentralised", url: "https://chutes.ai" },
  { id: "friendli", label: "Friendli", note: "free credits", url: "https://suite.friendli.ai" },
  { id: "codestral", label: "Codestral (Mistral)", note: "free · code specialist", url: "https://console.mistral.ai/codestral" },
  { id: "inference", label: "Inference.net", note: "free credits · OpenAI-compatible", url: "https://inference.net" },
  { id: "vercel", label: "Vercel AI Gateway", note: "$5 free credits every month · 100s of models", url: "https://vercel.com/ai-gateway" },
  { id: "ovh", label: "OVHcloud AI", note: "free tier · EU · OpenAI-compatible", url: "https://endpoints.ai.cloud.ovh.net" },
  { id: "gmi", label: "GMI Cloud", note: "free credits · DeepSeek/Llama/Qwen", url: "https://console.gmicloud.ai" },
  // ── Premium (paid — only used if you pick "Best", never on free) ──
  { id: "anthropic", label: "Anthropic (Claude)", note: "premium · paid", url: "https://console.anthropic.com/settings/keys", premium: true },
  { id: "openai", label: "OpenAI", note: "premium · paid", url: "https://platform.openai.com/api-keys", premium: true },
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

  const refresh = () => {
    getAdminConfig().then((c) => {
      setCfg(c);
      setVoice(c.elevenVoice || "");
      setIntegrations((prev) => ({ ...prev, linearTeam: c.linearTeam || "" }));
      // hydrate the non-secret email fields (password is never returned — placeholder shows if set)
      if (c.email) setEmail({ smtpHost: c.email.smtpHost || "", smtpPort: c.email.smtpPort || "", smtpUser: c.email.smtpUser || "", smtpPass: "", smtpFrom: c.email.smtpFrom || "", ownerEmail: c.email.ownerEmail || "" });
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
          return (
            <>
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
