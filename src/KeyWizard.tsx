import { useState, useEffect } from "react";
import { useEscape } from "./lib/useOverlay";

// ⚡ Power up SAM — 60-second free-key wizard. Each provider: deep-link to its key page, paste field,
// live validation (a real test call), green tick when pooled. Progress meter gamifies the pool.
// SAM already works free out of the box — this is a pure upgrade, never a gate.
const PROVIDERS = [
  { id: "groq",       label: "Groq",          note: "fastest · ~30-sec signup", url: "https://console.groq.com/keys",        rx: /^gsk_[A-Za-z0-9]{20,}$/ },
  { id: "gemini",     label: "Google Gemini", note: "adds photos & vision",     url: "https://aistudio.google.com/apikey",   rx: /^AIza[A-Za-z0-9_\-]{30,}$/ },
  { id: "openrouter", label: "OpenRouter",    note: "300+ models, one key",     url: "https://openrouter.ai/keys",           rx: /^sk-or-[A-Za-z0-9\-]{20,}$/ },
  { id: "mistral",    label: "Mistral",       note: "strong, generous free",    url: "https://console.mistral.ai/api-keys",  rx: /^[A-Za-z0-9]{32}$/ },
];
type St = "idle" | "checking" | "ok" | "bad";

export default function KeyWizard({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, St>>({});
  const [clip, setClip] = useState<{ id: string; key: string } | null>(null);
  const online = Object.values(status).filter((s) => s === "ok").length;

  async function validate(id: string, key: string) {
    setKeys((k) => ({ ...k, [id]: key }));
    const v = key.trim();
    if (!v) { setStatus((s) => ({ ...s, [id]: "idle" })); return; }
    setStatus((s) => ({ ...s, [id]: "checking" }));
    try {
      const r = await fetch("/api/admin/validate-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: id, key: v }) }).then((x) => x.json());
      if (r.valid === false) { setStatus((s) => ({ ...s, [id]: "bad" })); return; }
      await fetch("/api/admin/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: id, keys: v }) });
      setStatus((s) => ({ ...s, [id]: "ok" }));
    } catch { setStatus((s) => ({ ...s, [id]: "bad" })); }
  }

  // Clipboard watcher — if a key-shaped string is copied, offer to slot it into the right provider.
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const t = (await navigator.clipboard.readText()).trim();
        const hit = PROVIDERS.find((p) => p.rx.test(t) && status[p.id] !== "ok" && keys[p.id] !== t);
        if (hit) setClip({ id: hit.id, key: t }); else if (clip && !PROVIDERS.find((p) => p.rx.test(t))) setClip(null);
      } catch { /* clipboard blocked — fine */ }
    }, 1800);
    return () => clearInterval(iv);
  }, [status, keys, clip]);

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer wizard" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">⚡ Power up SAM</div>
            <div className="drawer-sub">{online} of {PROVIDERS.length} free brains online — each takes ~30 seconds, all free. (SAM already works right now.)</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="wiz-meter"><span style={{ width: `${(online / PROVIDERS.length) * 100}%` }} /></div>

        {clip && (
          <div className="wiz-clip">📋 Spotted a <b>{PROVIDERS.find((p) => p.id === clip.id)?.label}</b> key on your clipboard —{" "}
            <button className="wiz-add" onClick={() => { validate(clip.id, clip.key); setClip(null); }}>add it</button>
            <button className="wiz-x" onClick={() => setClip(null)}>dismiss</button>
          </div>
        )}

        <div className="wiz-list">
          {PROVIDERS.map((p) => {
            const st = status[p.id] || "idle";
            return (
              <div key={p.id} className={"wiz-row " + st}>
                <div className="wiz-top">
                  <span className="wiz-name">{p.label} {st === "ok" && <span className="wiz-live">✓ online</span>}</span>
                  <a className="wiz-get" href={p.url} target="_blank" rel="noreferrer">Get free key ↗</a>
                </div>
                <div className="wiz-note">{p.note}</div>
                <div className="wiz-inp">
                  <input type="password" placeholder={st === "ok" ? "pooled ✓" : "paste your key here"} value={keys[p.id] || ""} onChange={(e) => validate(p.id, e.target.value)} />
                  <span className={"wiz-tick " + st}>{st === "checking" ? "…" : st === "ok" ? "✓" : st === "bad" ? "✗ invalid" : ""}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="wiz-foot">{online > 0
          ? `🎉 ${online} brain${online === 1 ? "" : "s"} online — SAM's getting stronger. SAM rotates across all of them so you never hit a limit.`
          : "Grab any one above — or none. SAM's free out of the box; keys just add speed, photos & voice."}</div>
      </aside>
    </div>
  );
}
