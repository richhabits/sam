import { useState, useEffect } from "react";
import { getStatus } from "./lib/api";
import Icon from "./Icon";
import { useEscape } from "./lib/useOverlay";

// Live Usage — even though it's all free, this shows WHERE SAM is spending each provider,
// which are rate-limited right now, and when they free up. So you can see if you're leaning on
// one too hard → add another free key or let SAM spread the load.

type Pool = { provider: string; total: number; healthy: number; cooling: number; uses: number; coolingUntil: number };
type Prov = { id: string; tier: string; keys: number };

export default function Usage({ onClose }: { onClose: () => void }) {
  const [pools, setPools] = useState<Pool[]>([]);
  const [provs, setProvs] = useState<Prov[]>([]);
  const [, tick] = useState(0);
  useEscape(onClose);

  useEffect(() => {
    const load = () => getStatus().then((s) => { setPools(s?.models?.pools || []); setProvs(s?.models?.providers || []); }).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
    load();
    const a = setInterval(load, 6000);          // refresh data
    const b = setInterval(() => tick((n) => n + 1), 1000);  // live countdown
    return () => { clearInterval(a); clearInterval(b); };
  }, []);

  const active = pools.filter((p) => p.total > 0).sort((a, b) => b.uses - a.uses);
  const maxUses = Math.max(1, ...active.map((p) => p.uses));
  const totalUses = active.reduce((a, p) => a + p.uses, 0);
  const freeWithKeys = provs.filter((p) => p.tier === "free" && p.keys > 0).length;

  const resetIn = (until: number) => {
    const s = Math.max(0, Math.round((until - Date.now()) / 1000));
    return s > 90 ? `${Math.round(s / 60)}m` : `${s}s`;
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer usage" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title"><Icon name="chart" size={19} /> Live usage</div>
            <div className="drawer-sub">{freeWithKeys} free provider{freeWithKeys === 1 ? "" : "s"} · {totalUses} calls this session</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>

        {active.length === 0 && (
          <div className="drawer-empty">No keyed providers yet — SAM's running on the free no-key brain. Add free keys (<Icon name="key" size={14} /> up top) and you'll see each one's usage here.</div>
        )}

        <div className="use-list">
          {active.map((p) => {
            const cooling = p.cooling > 0 && p.coolingUntil > Date.now();
            return (
              <div key={p.provider} className={"use-row" + (cooling ? " cooling" : "")}>
                <div className="use-top">
                  <span className="use-name">{p.provider}</span>
                  <span className={"use-badge " + (cooling ? "cool" : "ok")}>
                    {cooling
                      ? <><Icon name="clock" size={12} /> {resetIn(p.coolingUntil)}</>
                      : <><Icon name="check" size={12} /> Ready</>}
                  </span>
                  <span className="use-count">{p.uses} calls</span>
                </div>
                <div className="use-bar"><span style={{ width: `${Math.round((p.uses / maxUses) * 100)}%` }} /></div>
                <div className="use-meta">{p.total} key{p.total === 1 ? "" : "s"} · {p.healthy} ready{p.cooling ? ` · ${p.cooling} cooling` : ""}</div>
              </div>
            );
          })}
        </div>

        <div className="use-foot">
          <Icon name="sparkle" size={14} /> One provider maxed while others idle? SAM already rotates — a second free key just gives it more headroom.
        </div>
      </aside>
    </div>
  );
}
