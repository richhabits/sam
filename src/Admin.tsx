import { useState, useEffect } from "react";
import { getAdminConfig, saveKeys, saveConfig, getAllowed, setAllow } from "./lib/api";

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

  const refresh = () => {
    getAdminConfig().then((c) => { setCfg(c); setVoice(c.elevenVoice || ""); }).catch(() => {});
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
