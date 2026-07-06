import { useState, useEffect } from "react";
import { getAdminConfig, saveKeys, saveConfig, getAllowed, setAllow, testEmail } from "./lib/api";

const PROVIDERS = [
  { id: "nvidia", label: "NVIDIA", note: "free · capable 70B · generous limits", url: "https://build.nvidia.com" },
  { id: "groq", label: "Groq", note: "free · fastest · 70B", url: "https://console.groq.com/keys" },
  { id: "cerebras", label: "Cerebras", note: "free · blazing fast · 70B", url: "https://cloud.cerebras.ai" },
  { id: "mistral", label: "Mistral", note: "free tier · capable", url: "https://console.mistral.ai/api-keys" },
  { id: "github", label: "GitHub Models", note: "free with a GitHub token", url: "https://github.com/settings/tokens" },
  { id: "gemini", label: "Gemini", note: "free · multimodal (photos) · small daily cap", url: "https://aistudio.google.com/apikey" },
  { id: "openrouter", label: "OpenRouter", note: "free tier", url: "https://openrouter.ai/keys" },
  { id: "anthropic", label: "Anthropic (Claude)", note: "premium", url: "https://console.anthropic.com/settings/keys" },
  { id: "openai", label: "OpenAI", note: "premium", url: "https://platform.openai.com/api-keys" },
];

export default function Admin({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<any>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [eleven, setEleven] = useState("");
  const [voice, setVoice] = useState("");
  const [saved, setSaved] = useState("");
  const [allowed, setAllowed] = useState<string[]>([]);
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

        {PROVIDERS.map((p) => (
          <div key={p.id} className="admin-row">
            <div className="admin-h"><span className="admin-name">{p.label}</span><span className="admin-note">{p.note}</span><span className="admin-count">{count(p.id)} key{count(p.id) === 1 ? "" : "s"}</span></div>
            <textarea className="admin-input" rows={2} placeholder={`Paste ${p.label} key(s) — comma or new line for many`}
              value={drafts[p.id] || ""} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))} />
            <div className="admin-actions">
              <button className="admin-save" onClick={() => saveProvider(p.id)}>{saved === p.id ? "Saved ✓" : "Save keys"}</button>
              <a className="admin-getkey" href={p.url} target="_blank" rel="noopener noreferrer">Get a free key ↗</a>
            </div>
          </div>
        ))}

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
