import QRCode from "qrcode";
import { useEffect, useState } from "react";
import Icon, { type IconName } from "./Icon";
import { configureMcp, disablePhone, enablePhone, getAdminConfig, getAllowed, getMcpPresets, getPhoneLink, getSigningStatus, regeneratePhone, removeMcp, saveConfig, saveKeys, setAllow, testEmail } from "./lib/api";
import { enablePush, pushEnabled } from "./lib/push";
import { useEscape } from "./lib/useOverlay";
import UsageTracker from "./UsageTracker";

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
  const [integrations, setIntegrations] = useState({ notion: "", slack: "", discord: "", twitter: "", linear: "", vercel: "", linearTeam: "" });
  const [email, setEmail] = useState({ smtpHost: "", smtpPort: "", smtpUser: "", smtpPass: "", smtpFrom: "", ownerEmail: "" });
  const [emailTest, setEmailTest] = useState("");
  const [_apple, setApple] = useState({ appleId: "", appleTeam: "", applePass: "" });
  const [phone, setPhone] = useState<{ remoteOn: boolean; lan: string | null; url: string | null }>({ remoteOn: false, lan: null, url: null });
  const [phoneQR, setPhoneQR] = useState("");
  // Same treatment as Settings and the Control Centre: this drawer was 43 providers + media +
  // voice + apps + integrations + phone + email in ONE scroll. Tabs keep each view to a screen.
  const [atab, setAtab] = useState<"brains" | "media" | "apps" | "devices" | "safety">("brains");
  // Provider rows averaged 177px each (label + note + open paste box + save + link), so 11 of
  // them was 4 screens of scroll before you reached anything else. They're summary rows now and
  // only the one you're actually adding a key to opens. Same disclosure pattern a settings app
  // uses for a long list of accounts.
  const [openRow, setOpenRow] = useState<string>("");
  const [phoneMsg, setPhoneMsg] = useState("");
  const [pushOn, setPushOn] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [mcp, setMcp] = useState<McpPreset[]>([]);
  const [mcpKeys, setMcpKeys] = useState<Record<string, Record<string, string>>>({});
  const [mcpMsg, setMcpMsg] = useState<Record<string, string>>({});
  const [_signing, setSigning] = useState<any>(null);
  const [_signingMsg, _setSigningMsg] = useState("");
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
    setAtab("devices");   // the phone section lives in Devices — select the tab, then scroll
    const t = setTimeout(() => {
      document.getElementById("admin-phone")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);   // after the drawer paints
    return () => clearTimeout(t);
  }, [focus]);
  const PROVIDERS: Prov[] = (cfg?.providers as Prov[]) || [];
  const count = (id: string) => PROVIDERS.find((p) => p.id === id)?.keys ?? 0;
  // 1600ms was too quick to notice: a user saved a Kimi key, the confirmation came and went, and
  // they reasonably concluded nothing had happened — the key WAS stored. A save that succeeds
  // silently is indistinguishable from one that failed, which is the same class of bug as the
  // 400-that-said-"Saved" this panel had before. 5s, plus a persistent line below the row.
  const flash = (id: string) => { setSaved(id); setTimeout(() => setSaved(""), 5000); };

  async function saveProvider(id: string) {
    const value = (drafts[id] || "").trim();
    if (!value) return;
    // The response used to be ignored, so a 400 still flashed "saved" and the user believed a key
    // was stored that never was. Checking `r.error` fixed that — until api.ts began THROWING on a
    // non-OK response, which made the check unreachable: the rejection went past it to the global
    // handler, and this row's own inline message never appeared. Catch it here so the error lands
    // where the key was typed, next to the field, rather than in a banner at the foot of the app.
    const spec = PROVIDERS.find((p) => p.id === id);
    try {
      const r = spec?.configStyle ? await saveConfig(id, value) : await saveKeys(id, value);
      if (r?.error) { setSaveError({ id, msg: String(r.error) }); return; }
    } catch (e: any) { setSaveError({ id, msg: e?.message || "SAM refused that — the key was not saved." }); return; }
    setSaveError(null);
    setDrafts((d) => ({ ...d, [id]: "" }));
    flash(id); refresh();
  }
  async function saveEleven() {
    // AUDIT FIX: check each save's result — don't flash "Saved ✓" when the server refused.
    // Wrapped for the same reason as saveProvider: a refusal now throws, so the checks alone
    // would let it past this function entirely and lose the inline message.
    try {
      if (eleven.trim()) { const r = await saveConfig("elevenlabs", eleven.trim()); if (r?.error) { setSaveError({ id: "elevenlabs", msg: String(r.error) }); return; } }
      if (voice.trim()) { const r = await saveConfig("elevenVoice", voice.trim()); if (r?.error) { setSaveError({ id: "elevenlabs", msg: String(r.error) }); return; } }
    } catch (e: any) { setSaveError({ id: "elevenlabs", msg: e?.message || "SAM refused that — nothing was saved." }); return; }
    setSaveError(null); setEleven(""); flash("elevenlabs"); refresh();
  }
  async function setService(v: string) { await saveConfig("musicService", v); refresh(); }

  async function saveEmail() {
    // Only send fields the user actually changed (blank password = keep the saved one).
    // AUDIT FIX: check each save and stop at the first failure — never flash "Saved ✓" on an error.
    const fields: [string, string][] = [
      ["smtpHost", email.smtpHost], ["smtpPort", email.smtpPort], ["smtpUser", email.smtpUser],
      ["smtpPass", email.smtpPass], ["smtpFrom", email.smtpFrom], ["ownerEmail", email.ownerEmail],
    ];
    // Stops at the first failure, whether it arrives as an { error } body or as a throw — half a
    // mail configuration saved is worse than none, and "Saved ✓" over it would be worse again.
    try {
      for (const [key, val] of fields) {
        if (!val) continue;
        const r = await saveConfig(key, val.trim());
        if (r?.error) { setSaveError({ id: "email", msg: String(r.error) }); return; }
      }
    } catch (e: any) { setSaveError({ id: "email", msg: e?.message || "SAM refused that — the settings were not saved." }); return; }
    setSaveError(null);
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
    // Missed in the same "don't flash Saved on a server error" pass that fixed saveProvider/
    // saveEleven/saveEmail (see their AUDIT FIX comments) — this one still ignored every
    // response and always flashed "Saved ✓", so a rejected Notion/Slack/Discord/Twitter/
    // Linear/Vercel key looked identical to a stored one.
    const fields: [string, string][] = [
      ["notion", integrations.notion], ["slack", integrations.slack], ["discord", integrations.discord],
      ["twitter", integrations.twitter], ["linear", integrations.linear],
      ["linearTeam", integrations.linearTeam], ["vercel", integrations.vercel],
    ];
    for (const [key, val] of fields) {
      if (!val) continue;
      const r = await saveConfig(key, val.trim());
      if (r?.error) { setSaveError({ id: "integrations", msg: String(r.error) }); return; }
    }
    setSaveError(null);
    setIntegrations({ notion: "", slack: "", discord: "", twitter: "", linear: "", vercel: "", linearTeam: integrations.linearTeam });
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
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        <div className="pop-tabs adm-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={atab === "brains"} className={atab === "brains" ? "on" : ""} onClick={() => setAtab("brains")}>Brains</button>
          <button type="button" role="tab" aria-selected={atab === "media"} className={atab === "media" ? "on" : ""} onClick={() => setAtab("media")}>Media</button>
          <button type="button" role="tab" aria-selected={atab === "apps"} className={atab === "apps" ? "on" : ""} onClick={() => setAtab("apps")}>Apps</button>
          <button type="button" role="tab" aria-selected={atab === "devices"} className={atab === "devices" ? "on" : ""} onClick={() => setAtab("devices")}>Devices</button>
          <button type="button" role="tab" aria-selected={atab === "safety"} className={atab === "safety" ? "on" : ""} onClick={() => setAtab("safety")}>Safety</button>
        </div>
        {atab === "brains" && (() => {
          const row = (p: Prov) => (
            <div key={p.id} className={`admin-row${openRow === p.id ? " open" : ""}`}>
              <button type="button" className="admin-rowhead" onClick={() => setOpenRow((v) => (v === p.id ? "" : p.id))}
                aria-expanded={openRow === p.id}>
                <span className="admin-name">{p.label}</span>
                <span className="admin-keys">{count(p.id) > 0 ? `${count(p.id)} key${count(p.id) > 1 ? "s" : ""}` : "Add"}</span>
                <span className={`admin-chev${openRow === p.id ? " open" : ""}`} aria-hidden="true">›</span>
              </button>
              {openRow === p.id && (<>
              <div className="admin-h"><span className="admin-note">{p.note}</span><span className="admin-count">{count(p.id)} key{count(p.id) === 1 ? "" : "s"}</span></div>
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
              </>)}
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
          const ABILITIES: { icon: IconName; label: string; on: boolean; via: string; up: string }[] = [
            { icon: "chat", label: "Chat", on: true, via: activeKeys ? `${activeKeys} free brains, rotating` : "free no-key brain + Ollama", up: activeKeys ? "" : "add Groq/Cerebras for speed" },
            { icon: "studio", label: "Images", on: true, via: has("together") || has("siliconflow") ? "unlimited + free-credit lanes" : "Pollinations — unlimited, no key", up: has("together") || has("siliconflow") ? "" : "add Together for FLUX quality" },
            { icon: "voice", label: "Voice", on: true, via: cfg?.elevenlabs ? "ElevenLabs premium" : has("groq") ? "Groq TTS (free)" : "free voice, no key", up: cfg?.elevenlabs ? "" : "add ElevenLabs for premium voice" },
            { icon: "eye", label: "Photo reading", on: has("gemini"), via: has("gemini") ? "Gemini (free)" : "", up: has("gemini") ? "" : "add a free Gemini key (or run Ollama + llava)" },
            { icon: "music", label: "Transcription", on: has("groq"), via: has("groq") ? "Groq Whisper (free)" : "", up: has("groq") ? "" : "add a free Groq key" },
            { icon: "video", label: "Video", on: has("fal") || has("novita") || has("siliconflow"), via: has("fal") ? "HappyHorse #1 (fal)" : has("novita") ? "Novita credits" : has("siliconflow") ? "SiliconFlow credits" : "", up: has("fal") ? "" : "add fal (HappyHorse!) / Novita / SiliconFlow" },
          ];
          return (
            <>
              <div className="admin-matrix">
                {ABILITIES.map((a) => (
                  <div key={a.label} className={"matrix-cell" + (a.on ? " on" : "")}>
                    <span className="matrix-ic"><Icon name={a.icon} size={17} /></span>
                    <span className="matrix-name">{a.label}</span>
                    <span className="matrix-via">{a.on ? `✓ ${a.via}` : "off"}{a.up ? ` · ${a.up}` : ""}</span>
                  </div>
                ))}
              </div>
              <UsageTracker pools={cfg?.pools || []} />
              <div className="admin-lead"><b>All free.</b> Grab a key from as many as you like — SAM spreads work across them all (sipping each lightly so your free quotas last), and hops on when one's busy. {activeKeys > 0 ? `You've got ${activeKeys} provider${activeKeys === 1 ? "" : "s"} connected.` : "Start with one — 2 minutes."} <span style={{ opacity: .8 }}>Even with zero keys, SAM falls back to a no-key free brain + local Ollama — so it never goes dark.</span></div>
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
        {atab === "media" && (<>
        <div className="admin-cat"><Icon name="studio" /> Media &amp; voice</div>

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
          <div className="admin-h"><span className="admin-name"><Icon name="camera" size={15} /> Stock media &amp; assets</span><span className="admin-note">real photos, b-roll, GIFs, film info — free keys</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {([["pexels","Pexels","https://www.pexels.com/api/","photos + video"],["pixabay","Pixabay","https://pixabay.com/api/docs/","photos + video + music"],["giphy","GIPHY","https://developers.giphy.com/","GIFs"],["tmdb","TMDb","https://www.themoviedb.org/settings/api","film info + posters"],["omdb","OMDb","https://www.omdbapi.com/apikey.aspx","film info (backup)"]] as const).map(([id,label,url,note]) => (
              <div key={id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="admin-input" style={{ flex: 1, margin: 0 }} type="password" placeholder={`${label} key ${cfg?.media?.[id] ? "(saved)" : ""} — ${note}`} value={(mediaKeys as any)[id]} onChange={(e) => setMediaKeys(m => ({ ...m, [id]: e.target.value }))} />
                <a className="admin-getkey" href={url} target="_blank" rel="noreferrer">FREE key ↗</a>
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0", paddingTop: 8 }} />
            <div className="admin-note" style={{ marginBottom: 4 }}><Icon name="cloud" size={14} /> <b>Cloudflare FLUX</b> — the big free image lane (~100k/day). <a className="admin-getkey" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">get token ↗</a></div>
            <input className="admin-input" style={{ margin: 0 }} placeholder={`Cloudflare Account ID ${cfg?.media?.cloudflareAccount ? "(saved)" : ""}`} value={mediaKeys.cloudflareAccount} onChange={(e) => setMediaKeys(m => ({ ...m, cloudflareAccount: e.target.value }))} />
            <input className="admin-input" style={{ margin: 0 }} type="password" placeholder="Cloudflare API Token (Workers AI)" value={mediaKeys.cloudflareToken} onChange={(e) => setMediaKeys(m => ({ ...m, cloudflareToken: e.target.value }))} />
            <button type="button" className="admin-save" style={{ width: "auto" }} onClick={async () => {
              for (const [id, v] of Object.entries(mediaKeys)) if (v.trim()) await saveConfig(id, v.trim());
              setMediaKeys({ pexels: "", pixabay: "", giphy: "", tmdb: "", omdb: "", cloudflareAccount: "", cloudflareToken: "" }); flash("media"); refresh();
            }}>{saved === "media" ? "Saved ✓" : "Save media keys"}</button>
          </div>
        </div>

        </>)}
        {atab === "apps" && (<>
        <div className="admin-cat"><Icon name="folder" /> Connect your apps</div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">3rd-Party Integrations</span><span className="admin-note">keys for Notion, Slack, etc.</span></div>
          <div style={{display:"flex", gap: 8, flexDirection:"column", marginTop:12}}>
            <input className="admin-input" placeholder={`Notion API Key ${cfg?.notion ? "(Saved)" : ""}`} value={integrations.notion} onChange={(e) => setIntegrations(i => ({...i, notion: e.target.value}))} />
            <input className="admin-input" placeholder={`Slack Bot Token ${cfg?.slack ? "(Saved)" : ""}`} value={integrations.slack} onChange={(e) => setIntegrations(i => ({...i, slack: e.target.value}))} />
            <input className="admin-input" placeholder={`Discord Webhook URL ${cfg?.discord ? "(Saved)" : ""}`} value={integrations.discord} onChange={(e) => setIntegrations(i => ({...i, discord: e.target.value}))} />
            <input className="admin-input" placeholder={`X (Twitter) Bearer Token ${cfg?.twitter ? "(Saved)" : ""}`} value={integrations.twitter} onChange={(e) => setIntegrations(i => ({...i, twitter: e.target.value}))} />
            <input className="admin-input" placeholder={`Linear API Key ${cfg?.linear ? "(Saved)" : ""}`} value={integrations.linear} onChange={(e) => setIntegrations(i => ({...i, linear: e.target.value}))} />
            <input className="admin-input" placeholder="Linear Team ID" value={integrations.linearTeam} onChange={(e) => setIntegrations(i => ({...i, linearTeam: e.target.value}))} />
            {/* The yard already deployed with this one; there was just nowhere to paste it. */}
            <input className="admin-input" placeholder={`Vercel Token ${cfg?.vercel ? "(Saved)" : ""}`} value={integrations.vercel} onChange={(e) => setIntegrations(i => ({...i, vercel: e.target.value}))} />
            <button type="button" className="admin-save" onClick={saveIntegrations} style={{width:"auto", alignSelf:"flex-start"}}>{saved === "integrations" ? "Saved ✓" : "Save Integrations"}</button>
          </div>
        </div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name"><Icon name="mail" size={15} /> SAM's email {cfg?.email?.configured ? "· on" : ""}</span><span className="admin-note">so SAM can email your brief + nudges, and send on its own</span></div>
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
            <input className="admin-input" type="password" placeholder="App password" value={email.smtpPass} onChange={(e) => setEmail(v => ({ ...v, smtpPass: e.target.value }))} />
            {cfg?.email?.smtpPassSet && <span className="admin-note" style={{ fontSize: 12, marginTop: -4 }}>Password saved — leave blank to keep it</span>}
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
        <div className="admin-cat"><Icon name="briefcase" /> Business integrations</div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name"><Icon name="link" size={15} /> Integrations — connect your business tools</span><span className="admin-note">one-tap MCP: revenue, ads, social, workspace — SAM gains their tools (always ask-first)</span></div>
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

        </>)}
        {atab === "devices" && (<>
        <div className="admin-cat" id="admin-phone"><Icon name="phone" /> Phone &amp; devices</div>

        <div className="admin-row">
          {/* NAMED FOR WHICH ONE IT IS. There are two ways to reach SAM from a phone and they
              are not interchangeable: this QR carries a remote-access token and opens SAM in the
              phone's BROWSER, while the SAM app pairs with a one-time code from Dashboard →
              Devices. Both were called "phone" in different corners of the UI, so scanning this
              one expecting the app to pair is a dead end that looks like a broken app. */}
          <div className="admin-h" style={{ textAlign: "center", borderBottom: "none" }}>
            <span className="admin-name" style={{ fontSize: 24, fontWeight: 700 }}>Phone Pairing</span>
          </div>
          <div className="admin-note" style={{ marginBottom: 6, fontSize: 13, color: "var(--muted)" }}>
            {"Open SAM in your phone's browser (remote access). To pair the native app instead, go to "}
            <b>Dashboard → Devices → Pair a phone</b>.
          </div>
          {phone.remoteOn && phoneQR ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 24, alignItems: "center", marginTop: 12 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 8 }}>Scan with your phone's camera to pair</div>
                <div style={{ fontSize: 14, color: "#666", lineHeight: 1.5, maxWidth: 400 }}>Point your iPhone's camera at the QR code below to quickly and securely connect your device.</div>
              </div>
              <img src={phoneQR} alt="Scan to pair" style={{ width: 260, height: 260, borderRadius: 16, background: "#fff", padding: 12, border: "1px solid #EAEAEA", boxShadow: "0 8px 32px rgba(0,0,0,0.05)" }} />
              
              <div style={{ fontSize: 13, color: "#666", marginTop: 12, textAlign: "center", maxWidth: 350 }}>
                Make sure your iPhone is connected to the same Wi-Fi network.
              </div>
              
              <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
                <button type="button" style={{ background: "#F26101", color: "white", padding: "12px 24px", borderRadius: 24, border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 16px rgba(242, 97, 1, 0.3)" }} onClick={() => onClose()}>
                  Continue
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div className="admin-note" style={{ marginBottom: 10, lineHeight: 1.5 }}>Turn on phone access — SAM opens to your Wi-Fi with a private token, and you scan a QR to connect. {phoneMsg && <b style={{ color: "var(--accent-text)" }}>{phoneMsg}</b>}</div>
              <button type="button" className="admin-save" style={{ width: "auto" }} onClick={async () => {
                const sd = (window as any).samDesktop;
                setPhoneMsg(sd?.relaunch ? "Turning on — restarting SAM…" : "Turning on…");
                const r = await enablePhone().catch(() => ({ ok: false }));
                if (!r.ok) { setPhoneMsg("Couldn't enable — try again."); return; }
                if (sd?.relaunch) {
                  // The LAN bind only takes effect on a fresh process (see enablePhone's own
                  // comment). Mark where to land after the restart SAM is about to do for you,
                  // so you come back to this exact QR instead of the chat welcome screen.
                  try { localStorage.setItem("sam.reopenAdminPhone", "1"); } catch { /* storage full/disabled — you'll just land on the welcome screen instead */ }
                  sd.relaunch();
                } else {
                  setPhoneMsg("✓ Enabled — restart SAM (quit & reopen), then come back here for the QR.");
                }
              }}>Turn on phone access</button>
            </div>
          )}
          <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid #EAEAEA", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><Icon name="bell" size={16} /> Device Alerts</div>
              <div style={{ fontSize: 13, color: "#666", maxWidth: 400 }}>Get morning briefs and task notifications on this device.</div>
              {pushMsg && <div style={{ fontSize: 13, color: "#F26101", marginTop: 4, fontWeight: 500 }}>{pushMsg}</div>}
            </div>
            <div>
              {pushOn ? (
                 <div style={{ background: "rgba(95,208,138,.15)", color: "#16a34a", padding: "8px 16px", borderRadius: 20, fontSize: 14, fontWeight: 600 }}>Enabled ✓</div>
              ) : (
                 <button type="button" style={{ background: "#F4F4F4", color: "#111", padding: "8px 20px", borderRadius: 20, border: "1px solid #EAEAEA", fontSize: 14, fontWeight: 600, cursor: "pointer" }} onClick={async () => {
                  setPushMsg("Enabling..."); const r = await enablePush();
                  setPushMsg(r === "ok" ? "" : r === "denied" ? "Blocked in browser settings." : r === "unsupported" ? "Push not supported." : "Couldn't enable.");
                  if (r === "ok") setPushOn(true);
                }}>Enable</button>
              )}
            </div>
          </div>
        </div>

        </>)}
        {atab === "safety" && (<>
        <div className="admin-cat"><Icon name="shield" /> Safety &amp; permissions</div>

        <div className="admin-row">
          <div className="admin-h"><span className="admin-name">Authorized actions</span><span className="admin-note">SAM does these without asking</span></div>
          {allowed.length === 0
            ? <div className="admin-foot">None yet. When SAM asks approval, tap <b>Always allow</b> to authorise that action for good.</div>
            : <ul className="allow-list">{allowed.map((t) => (
                <li key={t}><span>{t.replace(/_/g, " ")}</span><button type="button" onClick={async () => { await setAllow(t, false); refresh(); }}>Revoke</button></li>
              ))}</ul>}
        </div>

        </>)}
        <div className="admin-foot">Keys are stored only on this computer (your .env). SAM never shows them back.</div>
      </aside>
    </div>
  );
}
