import { useState, useEffect } from "react";
import { getStatus, getLog, getSecurity } from "./lib/api";

// SAM control centre — one glance at everything: brains, tools, memory, activity.
const PROVIDER_LABEL: Record<string, string> = {
  cerebras: "Cerebras", groq: "Groq", nvidia: "NVIDIA", mistral: "Mistral",
  github: "GitHub Models", gemini: "Gemini", openrouter: "OpenRouter",
  anthropic: "Claude", openai: "OpenAI",
};

export default function Dashboard({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<any>(null);
  const [log, setLog] = useState<{ time: string; msg: string }[]>([]);
  const [sec, setSec] = useState<any>(null);

  useEffect(() => {
    const load = () => {
      getStatus().then(setS).catch(() => {});
      getLog().then((l) => setLog(l.slice(-8).reverse())).catch(() => {});
      getSecurity().then((d) => setSec(d.status)).catch(() => {});
    };
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  const providers = s?.models?.providers || [];
  const freeLive = providers.filter((p: any) => p.tier === "free" && p.keys > 0);
  const freeTotal = providers.filter((p: any) => p.tier === "free").length;

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer dash" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">SAM · Control Centre</div>
            <div className="drawer-sub">Everything SAM is running, at a glance.</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!s ? <div className="dash-empty">Connecting to SAM…</div> : (
          <>
            {/* headline stats */}
            <div className="dash-grid">
              <div className="dash-stat"><span className="dash-num">{freeLive.length}</span><span className="dash-lbl">free brains live</span></div>
              <div className="dash-stat"><span className="dash-num">{s.tools}</span><span className="dash-lbl">tools</span></div>
              <div className="dash-stat"><span className="dash-num">{s.skills}</span><span className="dash-lbl">skills</span></div>
              <div className="dash-stat"><span className="dash-num">{s.memory?.count ?? 0}</span><span className="dash-lbl">things remembered</span></div>
              <div className="dash-stat"><span className="dash-num">{s.projects}</span><span className="dash-lbl">brands</span></div>
              <div className="dash-stat"><span className="dash-num">{s.voice?.elevenlabs ? "ON" : "free"}</span><span className="dash-lbl">voice</span></div>
            </div>

            {/* brains */}
            <div className="dash-sec">AI brains ({freeLive.length}/{freeTotal} free lanes ready)</div>
            <div className="dash-lanes">
              {providers.map((p: any) => (
                <div key={p.id} className={`dash-lane ${p.keys > 0 ? "on" : ""}`}>
                  <span className={`dash-dot ${p.keys > 0 ? "live" : ""}`} />
                  <span className="dash-lane-name">{PROVIDER_LABEL[p.id] || p.id}</span>
                  <span className="dash-lane-tier">{p.tier}</span>
                  <span className="dash-lane-keys">{p.keys > 0 ? `${p.keys} key${p.keys > 1 ? "s" : ""}` : "—"}</span>
                </div>
              ))}
            </div>

            {/* security watchdog */}
            <div className="dash-sec">🛡️ Security</div>
            <div className={`dash-security ${sec && !sec.clear ? "flagged" : "clear"}`}>
              <span className="dash-shield">{sec && !sec.clear ? "⚠️" : "🛡️"}</span>
              <span>{sec ? sec.headline : "Checking…"}</span>
            </div>

            {/* activity */}
            <div className="dash-sec">Recent activity</div>
            {log.length === 0 ? <div className="dash-empty">Nothing yet — ask SAM something.</div> : (
              <ul className="dash-log">
                {log.map((e, i) => <li key={i}><span className="dash-time">{e.time}</span> {e.msg}</li>)}
              </ul>
            )}

            <div className="admin-foot">Running {s.defaultTier}-first on {s.platform}. Vault: {s.vault?.count ?? 0} notes. Everything local &amp; private.</div>
          </>
        )}
      </aside>
    </div>
  );
}
