import { useState, useEffect } from "react";
import { getAdminConfig, saveKeys, saveConfig, getAllowed, setAllow, testEmail, getPhoneLink, enablePhone, regeneratePhone, disablePhone, getMcpPresets, configureMcp, removeMcp, getSigningStatus, genAndroidKeystore } from "./lib/api";
import QRCode from "qrcode";
import { enablePush, pushEnabled } from "./lib/push";
import { useEscape } from "./lib/useOverlay";

type McpPreset = { id: string; label: string; emoji: string; note: string; official: boolean; fields: { env: string; label: string; placeholder?: string }[]; docs?: string; connected: boolean };

// Providers come from the SERVER (/api/admin/config -> providers[]), which derives them from
// server/providers.registry.ts. This file used to keep its own hardcoded copy — the fifth of
// five lists — and it drifted: `hermes` was offered here but unsaveable, and baidu / tencent /
// volcengine were wired brains this list never mentioned. Rendering what the server sends means
// Settings cannot offer a provider the server can't save, ever again.
type Prov = { id: string; label: string; note: string; url: string; starter?: boolean; premium?: boolean; noKey?: boolean; configStyle?: boolean; keys?: number };

export default function Admin({ onClose, focus }: { onClose: () => void; focus?: "phone" }) {
  useEscape(onClose);
  const [cfg, setCfg] = useState<any>(null);
  const [cfgErr, setCfgErr] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [eleven, setEleven] = useState("");
  const [voice, setVoice] = useState("");
  const [saved, setSaved] = useState("");
  const [saveError, setSaveError] = useState<{ id: string; msg: string } | null>(null);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [integrations, setIntegrations] = useState({ notion: "", slack: "", discord: "", twitter: "", linear: "", linearTeam: "" });
  const [email, setEmail] = useState({ smtpHost: "", smtpPort: "", smtpUser: "", smtpPass: "", smtpFrom: "", ownerEmail: "" });
  const [emailTest, setEmailTest] = useState("");
  const [apple, setApple] = useState({ appleId: "", appleTeam: "", applePass: "" });
  const [phone, setPhone] = useState<{ remoteOn: boolean; lan: string | null; url: string | null }>({ remoteOn: false, lan: null, url: null });
  const [phoneQR, setPhoneQR] = useState("");
  const [phoneMsg, setPhoneMsg] = useState("");
  const [pushOn, setPushOn] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [mcp, setMcp] = useState<McpPreset[]>([]);
  const [mcpKeys, setMcpKeys] = useState<Record<string, Record<string, string>>>({});
  const [mcpMsg, setMcpMsg] = useState<Record<string, string>>({});
  const [signing, setSigning] = useState<any>(null);
  const [signingMsg, setSigningMsg] = useState("");
  const [mediaKeys, setMediaKeys] = useState({ pexels: "", pixabay: "", giphy: "", tmdb: "", omdb: "", cloudflareAccount: "", cloudflareToken: "" });

  const refresh = () => {
    getAdminConfig().then((c) => {
      setCfg(c);
      setVoice(c.elevenVoice || "");
      setIntegrations((prev) => ({ ...prev, linearTeam: c.linearTeam || "" }));
      // hydrate the non-secret email fields (password is never returned — placeholder shows if set)
      if (c.email) setEmail({ smtpHost: c.email.smtpHost || "", smtpPort: c.email.smtpPort || "", smtpUser: c.email.smtpUser || "", smtpPass: "", smtpFrom: c.email.smtpFrom || "", ownerEmail: c.email.ownerEmail || "" });
      if (c.apple) setApple({ appleId: c.apple.appleId || "", appleTeam: c.apple.appleTeam || "", applePass: "" });
      setCfgErr("");
      // The provider list now comes from the server (one registry, no copy in src/). That means a
      // failed fetch would render an EMPTY settings panel — indistinguishable from "SAM has no
      // providers". Swallowing the error here is what made that silent, so it is surfaced below.
    }).catch(() => setCfgErr("Couldn't load settings from SAM. Is it running on this machine?"));
    getAllowed().then((a) => setAllowed(a.allowed || [])).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
    getPhoneLink().then((p) => { setPhone(p); if (p.url) QRCode.toDataURL(p.url, { width: 220, margin: 1 }).then(setPhoneQR).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */}); else setPhoneQR(""); }).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
    pushEnabled().then(setPushOn).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
    getMcpPresets().then((r) => setMcp(r.presets || [])).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
    getSigningStatus().then(setSigning).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount; refresh is stable
  useEffect(() => { refresh(); }, []);
  // When opened via Settings -> "Use SAM on your phone", jump to that section instead of
  // dropping the user at the top of a very long drawer and hoping they scroll.
  useEffect(() => {
    if (focus !== "phone") return;
    const t = setTimeout(() => {
      document.getElementById("admin-phone")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);   // after the drawer paints
    return () => clearTimeout(t);
  }, [focus]);
  const PROVIDERS: Prov[] = (cfg?.providers as Prov[]) || [];
  const count = (id: string) => PROVIDERS.find((p) => p.id === id)?.keys ?? 0;
  // 1600ms was too quick to notice: the user saved a Kimi key, the confirmation came and went, and
  // he reasonably concluded nothing had happened — the key WAS stored. A save that succeeds
  // silently is indistinguishable from one that failed, which is the same class of bug as the
  // 400-that-said-"Saved" this panel had before. 5s, plus a persistent line below the row.
  const flash = (id: string) => { setSaved(id); setTimeout(() => setSaved(""), 5000); };

  async function saveProvider(id: string) {
    const value = (drafts[id] || "").trim();
    if (!value) return;
    // The response used to be ignored, so a 400 still flashed "saved" and the user believed a
    // key was stored that never was. Check it, and say so when it fails.
    const spec = PROVIDERS.find((p) => p.id === id);
    const r = spec?.configStyle ? await saveConfig(id, value) : await saveKeys(id, value);
    if (r?.error) { setSaveError({ id, msg: String(r.error) }); return; }
    setSaveError(null);
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
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer admin" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">API keys &amp; providers</div>
            <div className="drawer-sub">Paste your free keys — SAM rotates through them so you never hit a limit. Add as many as you like (comma or new line). {totalKeys} loaded.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {(() => {
          const row = (p: Prov) => (
            <div key={p.id} className="admin-row">
              <div className="admin-h"><span className="admin-name">{p.label}</span><span className="admin-note">{p.note}</span><span className="admin-count">{count(p.id)} key{count(p.id) === 1 ? "" : "s"}</span></div>
              <textarea className="admin-input" rows={2} placeholder={`Paste ${p.label} key(s) — comma or new line for many`}
                value={drafts[p.id] || ""} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))} />
              <div className="admin-actions">
                <button type="button" className="admin-save" onClick={() => saveProvider(p.id)}>{saved === p.id ? "Saved ✓" : "Save keys"}</button>
                {saved === p.id && !saveError && (
                  <div className="admin-note admin-ok">
                    ✓ saved — SAM is using {p.label} now. No restart needed.
                  </div>
                )}
                {saveError?.id === p.id && (
                  <div className="admin-note" style={{ color: "#e06c6c", marginTop: 4 }}>
                    ✗ not saved — {saveError.msg}. Nothing was written; the key is still missing.
                  </div>
                )}
                <a className="admin-getkey" href={p.url} target="_blank" rel="noopener noreferrer">{p.premium ? "Get a key ↗" : "Get a FREE key ↗"}</a>
              </div>
            </div>
          );
          if (cfgErr) return <div className="admin-note" style={{ color: "#e06c6c" }}>✗ {cfgErr} <button type="button" className="admin-more" onClick={refresh}>Retry</button></div>;
          if (!cfg) return <div className="admin-note">Loading providers…</div>;
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
              <button type="button" className="admin-more" onClick={() => setShowMore((v) => !v)}>
                {showMore ? "▾ Hide extra free brains" : `▸ ＋ ${moreFree.length} more FREE brains — stack them for more free capacity`}
              </button>
              {showMore && moreFree.map(row)}
              <div className="admin-sub">Premium (paid — optional, only used if you pick “Best”)</div>
              {premium.map(row)}
            </>
          );
        })()}

        <div className="admin-cat">🎨 Media &amp; Voice</div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">ElevenLabs voice</span><span className="admin-note">premium voice</span><span className="admin-count">{cfg?.elevenlabs ? "on" : "off"}</span></div>
          <input className="admin-input" placeholder="ElevenLabs API key" value={eleven} onChange={(e) => setEleven(e.target.value)} />
          <input className="admin-input" placeholder="Voice ID (default: Rachel)" value={voice} onChange={(e) => setVoice(e.target.value)} />
          <button type="button" className="admin-save" onClick={saveEleven}>{saved === "elevenlabs" ? "Saved ✓" : "Save voice"}</button>
        </div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">Music service</span><span className="admin-note">where “play” opens tracks</span></div>
          <div className="admin-seg">
            {["apple", "spotify", "youtube"].map((s) => (
              <button type="button" key={s} className={cfg?.musicService === s ? "on" : ""} onClick={() => setService(s)}>{s}</button>
            ))}
          </div>
        </div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">📸 Stock media &amp; assets</span><span className="admin-note">real photos, b-roll, GIFs, film info — free keys</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {([["pexels","Pexels","https://www.pexels.com/api/","photos + video"],["pixabay","Pixabay","https://pixabay.com/api/docs/","photos + video + music"],["giphy","GIPHY","https://developers.giphy.com/","GIFs"],["tmdb","TMDb","https://www.themoviedb.org/settings/api","film info + posters"],["omdb","OMDb","https://www.omdbapi.com/apikey.aspx","film info (backup)"]] as const).map(([id,label,url,note]) => (
              <div key={id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="admin-input" style={{ flex: 1, margin: 0 }} type="password" placeholder={`${label} key ${cfg?.media?.[id] ? "(saved)" : ""} — ${note}`} value={(mediaKeys as any)[id]} onChange={(e) => setMediaKeys(m => ({ ...m, [id]: e.target.value }))} />
                <a className="admin-getkey" href={url} target="_blank" rel="noreferrer">FREE key ↗</a>
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0", paddingTop: 8 }} />
            <div className="admin-note" style={{ marginBottom: 4 }}>☁️ <b>Cloudflare FLUX</b> — the big free image lane (~100k/day). <a className="admin-getkey" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">get token ↗</a></div>
            <input className="admin-input" style={{ margin: 0 }} placeholder={`Cloudflare Account ID ${cfg?.media?.cloudflareAccount ? "(saved)" : ""}`} value={mediaKeys.cloudflareAccount} onChange={(e) => setMediaKeys(m => ({ ...m, cloudflareAccount: e.target.value }))} />
            <input className="admin-input" style={{ margin: 0 }} type="password" placeholder="Cloudflare API Token (Workers AI)" value={mediaKeys.cloudflareToken} onChange={(e) => setMediaKeys(m => ({ ...m, cloudflareToken: e.target.value }))} />
            <button type="button" className="admin-save" style={{ width: "auto" }} onClick={async () => {
              for (const [id, v] of Object.entries(mediaKeys)) if (v.trim()) await saveConfig(id, v.trim());
              setMediaKeys({ pexels: "", pixabay: "", giphy: "", tmdb: "", omdb: "", cloudflareAccount: "", cloudflareToken: "" }); flash("media"); refresh();
            }}>{saved === "media" ? "Saved ✓" : "Save media keys"}</button>
          </div>
        </div>

        <div className="admin-cat">🔗 Connect your apps</div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">3rd-Party Integrations</span><span className="admin-note">keys for Notion, Slack, etc.</span></div>
          <div style={{display:"flex", gap: 8, flexDirection:"column", marginTop:12}}>
            <input className="admin-input" placeholder={`Notion API Key ${cfg?.notion ? "(Saved)" : ""}`} value={integrations.notion} onChange={(e) => setIntegrations(i => ({...i, notion: e.target.value}))} />
            <input className="admin-input" placeholder={`Slack Bot Token ${cfg?.slack ? "(Saved)" : ""}`} value={integrations.slack} onChange={(e) => setIntegrations(i => ({...i, slack: e.target.value}))} />
            <input className="admin-input" placeholder={`Discord Webhook URL ${cfg?.discord ? "(Saved)" : ""}`} value={integrations.discord} onChange={(e) => setIntegrations(i => ({...i, discord: e.target.value}))} />
            <input className="admin-input" placeholder={`X (Twitter) Bearer Token ${cfg?.twitter ? "(Saved)" : ""}`} value={integrations.twitter} onChange={(e) => setIntegrations(i => ({...i, twitter: e.target.value}))} />
            <input className="admin-input" placeholder={`Linear API Key ${cfg?.linear ? "(Saved)" : ""}`} value={integrations.linear} onChange={(e) => setIntegrations(i => ({...i, linear: e.target.value}))} />
            <input className="admin-input" placeholder="Linear Team ID" value={integrations.linearTeam} onChange={(e) => setIntegrations(i => ({...i, linearTeam: e.target.value}))} />
            <button type="button" className="admin-save" onClick={saveIntegrations} style={{width:"auto", alignSelf:"flex-start"}}>{saved === "integrations" ? "Saved ✓" : "Save Integrations"}</button>
          </div>
        </div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">📧 SAM's email {cfg?.email?.configured ? "· on" : ""}</span><span className="admin-note">so SAM can email your brief + nudges, and send on its own</span></div>
          <div style={{ display: "flex", gap: 8, flexDirection: "column", marginTop: 12 }}>
            <div className="admin-note" style={{ marginBottom: 2 }}>Pick your provider (fills the settings) — or Custom for any SMTP:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {([["Gmail","smtp.gmail.com","587"],["Outlook","smtp-mail.outlook.com","587"],["iCloud","smtp.mail.me.com","587"],["Yahoo","smtp.mail.yahoo.com","465"],["Fastmail","smtp.fastmail.com","465"],["Proton Bridge","127.0.0.1","1025"],["Custom","",""]] as const).map(([label, host, port]) => (
                <button key={label} type="button" className={"stu-chip" + (email.smtpHost === host && host ? " on" : "")} onClick={() => setEmail(v => ({ ...v, smtpHost: host, smtpPort: port }))}>{label}</button>
              ))}
            </div>
            <input className="admin-input" placeholder="SMTP host (e.g. smtp.gmail.com)" value={email.smtpHost} onChange={(e) => setEmail(v => ({ ...v, smtpHost: e.target.value }))} />
            <div style={{ display: "flex", gap: 8 }}>
              <input className="admin-input" style={{ width: 110 }} placeholder="Port (587)" value={email.smtpPort} onChange={(e) => setEmail(v => ({ ...v, smtpPort: e.target.value }))} />
              <input className="admin-input" style={{ flex: 1 }} placeholder="Username (SAM's address)" value={email.smtpUser} onChange={(e) => setEmail(v => ({ ...v, smtpUser: e.target.value }))} />
            </div>
            <input className="admin-input" type="password" placeholder={cfg?.email?.smtpPassSet ? "App password (saved — leave blank to keep)" : "App password"} value={email.smtpPass} onChange={(e) => setEmail(v => ({ ...v, smtpPass: e.target.value }))} />
            <input className="admin-input" placeholder='From (e.g. SAM <sam@you.com>) — optional' value={email.smtpFrom} onChange={(e) => setEmail(v => ({ ...v, smtpFrom: e.target.value }))} />
            <input className="admin-input" placeholder="Send my brief to (your inbox)" value={email.ownerEmail} onChange={(e) => setEmail(v => ({ ...v, ownerEmail: e.target.value }))} />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" className="admin-save" onClick={saveEmail} style={{ width: "auto" }}>{saved === "email" ? "Saved ✓" : "Save email"}</button>
              <button type="button" className="admin-save" onClick={sendTest} style={{ width: "auto", opacity: cfg?.email?.configured ? 1 : 0.5 }} disabled={!cfg?.email?.configured}>Send test</button>
              {emailTest && <span className="admin-note" style={{ marginLeft: 4 }}>{emailTest}</span>}
            </div>
            <div className="admin-foot">Most providers (Gmail, iCloud, Yahoo, Fastmail) need an <b>App password</b> — not your normal login — created in your account's security settings. Outlook uses your normal password (or an app password if 2FA is on). Port 465 = TLS, 587 = STARTTLS. Any SMTP host works.</div>
          </div>
        </div>

        {/* Phone access is a top-level thing people go LOOKING for ("use SAM on my phone"), but it
            lived at the bottom of the keys drawer under 43 providers. Settings now links straight
            here and this anchor scrolls it into view. */}
        <div className="admin-cat" id="admin-phone">📱 Phone &amp; devices</div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">📱 Use SAM on your phone {phone.remoteOn ? "· on" : ""}</span><span className="admin-note">chat, camera &amp; voice from your phone on the same Wi-Fi</span></div>
          {phone.remoteOn && phoneQR ? (
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <img src={phoneQR} alt="Scan to open SAM on your phone" style={{ width: 160, height: 160, borderRadius: 12, background: "#fff", padding: 6 }} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Scan with your phone's camera 📷</div>
                <div className="admin-note" style={{ lineHeight: 1.5 }}>It opens SAM already signed in. Same Wi-Fi only. On the phone, tap <b>Share → Add to Home Screen</b> to install it like an app.</div>
                <div className="admin-note" style={{ marginTop: 6, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all", opacity: .7 }}>{phone.url?.replace(/token=.*/, "token=•••")}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button type="button" className="admin-save" style={{ width: "auto", background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }} onClick={async () => {
                    if (!window.confirm("Regenerate the phone token? Every connected device will be signed out and must re-scan.")) return;
                    const r = await regeneratePhone().catch(() => ({ ok: false }));
                    if (r.ok) { const p = await getPhoneLink(); setPhone(p); if (p.url) QRCode.toDataURL(p.url, { width: 220, margin: 1 }).then(setPhoneQR).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */}); setPhoneMsg("🔁 New token — old devices signed out. Re-scan the QR."); }
                  }}>🔁 New token</button>
                  <button type="button" className="admin-save" style={{ width: "auto", background: "transparent", border: "1px solid var(--c-err, #c00)", color: "var(--c-err, #c00)" }} onClick={async () => {
                    if (!window.confirm("Turn off phone access? SAM goes back to this-computer-only (restart to fully close the network).")) return;
                    const r = await disablePhone().catch(() => ({ ok: false }));
                    if (r.ok) { setPhone({ remoteOn: false, lan: phone.lan, url: null }); setPhoneQR(""); setPhoneMsg("🔴 Phone access off — restart SAM to fully close the LAN."); }
                  }}>🔴 Turn off</button>
                </div>
                <div className="admin-note" style={{ marginTop: 8, lineHeight: 1.5, opacity: .8 }}>🔒 Same-Wi-Fi traffic isn't encrypted — fine on your own home network. For access from <b>anywhere</b> (encrypted), use <a href="https://tailscale.com/" target="_blank" rel="noreferrer" style={{ color: "var(--accent-text)" }}>Tailscale</a>.</div>
                {phoneMsg && <div className="admin-note" style={{ marginTop: 6, color: "var(--accent-text)" }}>{phoneMsg}</div>}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div className="admin-note" style={{ marginBottom: 10, lineHeight: 1.5 }}>Turn on phone access — SAM opens to your Wi-Fi with a private token, and you scan a QR to connect. {phoneMsg && <b style={{ color: "var(--accent-text)" }}>{phoneMsg}</b>}</div>
              <button type="button" className="admin-save" style={{ width: "auto" }} onClick={async () => {
                setPhoneMsg("Turning on…");
                const r = await enablePhone().catch(() => ({ ok: false }));
                setPhoneMsg(r.ok ? "✓ Enabled — restart SAM (quit & reopen), then come back here for the QR." : "Couldn't enable — try again.");
              }}>Turn on phone access</button>
            </div>
          )}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <div className="admin-note" style={{ marginBottom: 8, lineHeight: 1.5 }}>🔔 <b>Alerts on this device</b> — get SAM's morning brief, reminders &amp; task results as push notifications, even when SAM's closed. {pushOn ? <b style={{ color: "var(--accent-text)" }}>· On for this device ✓</b> : ""} {pushMsg && <b style={{ color: "var(--accent-text)" }}>{pushMsg}</b>}</div>
            {!pushOn && <button type="button" className="admin-save" style={{ width: "auto" }} onClick={async () => {
              setPushMsg("…"); const r = await enablePush();
              setPushMsg(r === "ok" ? "" : r === "denied" ? "You blocked notifications — allow them in your browser/phone settings." : r === "unsupported" ? "This device doesn't support push (on iPhone: install SAM via Share → Add to Home Screen first)." : "Couldn't enable — try again.");
              if (r === "ok") setPushOn(true);
            }}>Get alerts here</button>}
          </div>
        </div>

        <div className="admin-cat">🔌 Business integrations</div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">🔌 Integrations — connect your business tools</span><span className="admin-note">one-tap MCP: revenue, ads, social, workspace — SAM gains their tools (always ask-first)</span></div>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {mcp.map((p) => (
              <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 18 }}>{p.emoji}</span>
                  <b>{p.label}</b>
                  {p.official ? <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 6, background: "var(--accent-soft, #2a2a2a)", opacity: .8 }}>official</span> : <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 6, border: "1px solid var(--border)", opacity: .6 }}>community</span>}
                  {p.connected && <span style={{ fontSize: 11, color: "var(--accent-text)", marginLeft: "auto" }}>✓ connected</span>}
                </div>
                <div className="admin-note" style={{ margin: "4px 0 8px" }}>{p.note}{p.docs && <> · <a href={p.docs} target="_blank" rel="noreferrer" style={{ color: "var(--accent-text)" }}>get key ↗</a></>}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {p.fields.map((f) => (
                    <input key={f.env} type="password" placeholder={f.label + (f.placeholder ? ` (${f.placeholder})` : "")} value={mcpKeys[p.id]?.[f.env] || ""}
                      onChange={(e) => setMcpKeys((m) => ({ ...m, [p.id]: { ...m[p.id], [f.env]: e.target.value } }))}
                      style={{ flex: "1 1 160px", minWidth: 120, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 }} />
                  ))}
                  <button type="button" className="admin-save" style={{ width: "auto" }} onClick={async () => {
                    const env = mcpKeys[p.id] || {};
                    if (p.fields.some((f) => !(env[f.env] || "").trim())) { setMcpMsg((m) => ({ ...m, [p.id]: "Add the key(s) first." })); return; }
                    setMcpMsg((m) => ({ ...m, [p.id]: "Connecting…" }));
                    const r = await configureMcp(p.id, env).catch(() => ({ ok: false }));
                    setMcpMsg((m) => ({ ...m, [p.id]: r.ok ? "✓ Saved — restart SAM to activate." : "Couldn't save." }));
                    if (r.ok) { setMcp((list) => list.map((x) => x.id === p.id ? { ...x, connected: true } : x)); setMcpKeys((m) => ({ ...m, [p.id]: {} })); }
                  }}>{p.connected ? "Update" : "Connect"}</button>
                  {p.connected && <button type="button" className="admin-save" style={{ width: "auto", background: "transparent", border: "1px solid var(--border)" }} onClick={async () => {
                    const r = await removeMcp(p.id).catch(() => ({ ok: false }));
                    if (r.ok) { setMcp((list) => list.map((x) => x.id === p.id ? { ...x, connected: false } : x)); setMcpMsg((m) => ({ ...m, [p.id]: "Removed — restart to apply." })); }
                  }}>Remove</button>}
                </div>
                {mcpMsg[p.id] && <div className="admin-note" style={{ marginTop: 6, color: "var(--accent-text)" }}>{mcpMsg[p.id]}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="admin-cat">🚀 Ship your app</div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">🍎 Sign the Mac app {signing?.mac?.ready ? "· ✓ ready" : ""}</span><span className="admin-note">so it opens with no "unidentified developer" warning</span></div>
          {/* SAM checks what you have and tells you exactly what's left — no external checklist. */}
          <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 13 }}>
              <span>{signing?.mac?.hasCert ? "✅" : "⬜️"} Developer ID certificate {signing?.mac?.certName ? <span className="admin-note">· {signing.mac.certName.slice(0, 42)}</span> : ""}</span>
              <span>{signing?.mac?.hasAppleId ? "✅" : "⬜️"} Apple ID &nbsp; {signing?.mac?.hasTeamId ? "✅" : "⬜️"} Team ID &nbsp; {signing?.mac?.hasPassword ? "✅" : "⬜️"} App password</span>
            </div>
            {signing?.mac?.next && <div className="admin-note" style={{ marginTop: 8, lineHeight: 1.5, color: signing.mac.ready ? "var(--c-ok, #22C55E)" : "var(--accent-text)" }}>👉 {signing.mac.next}</div>}
          </div>
          <div className="admin-note" style={{ margin: "10px 0", lineHeight: 1.6 }}>
            <b>3 one-time steps</b> (you need a <a href="https://developer.apple.com/programs/" target="_blank" rel="noreferrer" style={{ color: "var(--accent-text)" }}>paid Apple Developer account</a>, $99/yr):<br />
            1. <a href="https://developer.apple.com/account/resources/certificates/add" target="_blank" rel="noreferrer" style={{ color: "var(--accent-text)" }}>Create a “Developer ID Application” certificate ↗</a> → download → double-click to install it.<br />
            2. <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noreferrer" style={{ color: "var(--accent-text)" }}>Make an app-specific password ↗</a> (Sign-In &amp; Security).<br />
            3. Enter your Apple ID + Team ID + that password below → SAM signs &amp; notarizes on the next build.
          </div>
          <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
            <input className="admin-input" placeholder="Apple ID email" value={apple.appleId} onChange={(e) => setApple(v => ({ ...v, appleId: e.target.value }))} />
            <div style={{ display: "flex", gap: 8 }}>
              <input className="admin-input" style={{ width: 160 }} placeholder="Team ID (ABCDE12345)" value={apple.appleTeam} onChange={(e) => setApple(v => ({ ...v, appleTeam: e.target.value }))} />
              <input className="admin-input" type="password" style={{ flex: 1 }} placeholder={cfg?.apple?.applePassSet ? "App password (saved — blank keeps it)" : "App-specific password"} value={apple.applePass} onChange={(e) => setApple(v => ({ ...v, applePass: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="admin-save" style={{ width: "auto" }} onClick={async () => {
                if (apple.appleId) await saveConfig("appleId", apple.appleId.trim());
                if (apple.appleTeam) await saveConfig("appleTeam", apple.appleTeam.trim());
                if (apple.applePass) await saveConfig("applePass", apple.applePass.trim());
                setApple((v) => ({ ...v, applePass: "" })); flash("apple"); refresh(); getSigningStatus().then(setSigning).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
              }}>{saved === "apple" ? "Saved ✓" : "Save"}</button>
              <button type="button" className="admin-save" style={{ width: "auto", background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }} onClick={() => getSigningStatus().then(setSigning).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */})}>↻ Re-check</button>
            </div>
          </div>
        </div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">🤖 Android app {signing?.android?.hasKeystore ? "· keystore ready" : ""}</span><span className="admin-note">install SAM on Android — free, no account needed</span></div>
          <div className="admin-note" style={{ margin: "8px 0", lineHeight: 1.6 }}>
            SAM already installs as an app on Android <b>right now</b> — connect your phone (📱 above), open the link, then <b>⋮ → Add to Home Screen</b>. No signing, no Play Store, works today.<br />
            For a <b>Play Store</b> build later you'll need a signing keystore — SAM can make one for you, locally, no account:
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="admin-save" style={{ width: "auto" }} disabled={signing?.android?.hasKeystore} onClick={async () => {
              setSigningMsg("Generating keystore…");
              const r = await genAndroidKeystore().catch(() => ({ ok: false, error: "failed" }));
              setSigningMsg(r.ok ? `✅ Keystore created (vault/signing/). Password saved — keep it safe.` : `⚠️ ${r.error || "couldn't create"}`);
              getSigningStatus().then(setSigning).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
            }}>{signing?.android?.hasKeystore ? "Keystore ready ✓" : "Generate Android keystore"}</button>
            {signingMsg && <span className="admin-note">{signingMsg}</span>}
          </div>
        </div>

        <div className="admin-cat">🛡️ Safety &amp; permissions</div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">Authorized actions</span><span className="admin-note">SAM does these without asking</span></div>
          {allowed.length === 0
            ? <div className="admin-foot">None yet. When SAM asks approval, tap <b>Always allow</b> to authorise that action for good.</div>
            : <ul className="allow-list">{allowed.map((t) => (
                <li key={t}><span>{t.replace(/_/g, " ")}</span><button type="button" onClick={async () => { await setAllow(t, false); refresh(); }}>Revoke</button></li>
              ))}</ul>}
        </div>

        <div className="admin-foot">Keys are stored only on this computer (your .env). SAM never shows them back.</div>
      </aside>
    </div>
  );
}
