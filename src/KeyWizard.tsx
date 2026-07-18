import { useState, useEffect } from "react";
import { useEscape } from "./lib/useOverlay";

// ⚡ Power up SAM — 60-second free-key wizard. Each provider: deep-link to its key page, paste field,
// live validation (a real test call), green tick when pooled. Progress meter gamifies the pool.
// SAM already works free out of the box — this is a pure upgrade, never a gate.
// Providers come from the server registry (/api/admin/config), same as Settings. This file used
// to keep its own four-provider list WITH the key-format regexes — the sixth copy, and the only
// place those patterns lived. They now sit in server/providers.registry.ts as `keyPattern`, so
// the wizard and Settings can never disagree about what a provider is called or where to get it.
type WizProv = { id: string; label: string; note: string; url: string; keyPattern?: string };
type St = "idle" | "checking" | "ok" | "bad";

export default function KeyWizard({ onClose, onAllProviders }: { onClose: () => void; onAllProviders?: () => void }) {
  useEscape(onClose);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, St>>({});
  const [clip, setClip] = useState<{ id: string; key: string } | null>(null);
  const [PROVIDERS, setProviders] = useState<WizProv[]>([]);
  const [loadErr, setLoadErr] = useState("");
  useEffect(() => {
    fetch("/api/admin/config").then((r) => r.json())
      .then((c) => setProviders(((c?.providers || []) as WizProv[]).filter((p) => p.keyPattern)))
      .catch(() => setLoadErr("Couldn't load the provider list — check SAM is running."));
  }, []);
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
  // Depends on PROVIDERS now that the list is fetched rather than hardcoded: before it arrives
  // there is nothing to match against, so the effect must re-run once it does.
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const t = (await navigator.clipboard.readText()).trim();
        const hit = PROVIDERS.find((p) => p.keyPattern && new RegExp(p.keyPattern).test(t) && status[p.id] !== "ok" && keys[p.id] !== t);
        if (hit) setClip({ id: hit.id, key: t }); else if (clip && !PROVIDERS.find((p) => p.keyPattern && new RegExp(p.keyPattern).test(t))) setClip(null);
      } catch { /* clipboard blocked — fine */ }
    }, 1800);
    return () => clearInterval(iv);
  }, [status, keys, clip, PROVIDERS]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer wizard" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">⚡ Power up SAM</div>
            <div className="drawer-sub">{online} of {PROVIDERS.length} free brains online — each takes ~30 seconds, all free. (SAM already works right now.)</div>
            {loadErr && <div className="drawer-sub" style={{ color: "#e06c6c" }}>✗ {loadErr}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="wiz-meter"><span style={{ width: `${(online / PROVIDERS.length) * 100}%` }} /></div>

        {clip && (
          <div className="wiz-clip">📋 Spotted a <b>{PROVIDERS.find((p) => p.id === clip.id)?.label}</b> key on your clipboard —{" "}
            <button type="button" className="wiz-add" onClick={() => { validate(clip.id, clip.key); setClip(null); }}>add it</button>
            <button type="button" className="wiz-x" onClick={() => setClip(null)}>dismiss</button>
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
        {onAllProviders && (
          <button type="button" className="wiz-all" onClick={onAllProviders}>
            ＋ All 43 providers — GLM, Kimi, DeepSeek, Cerebras and the rest ↗
          </button>
        )}
      </aside>
    </div>
  );
}
