import { useCallback, useEffect, useState } from "react";
import Icon, { type IconName } from "./Icon";
import { type ConnectorList, type ConnectorRow, type ConnectorStatus, getConnectorRows, getConnectors } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// CONNECTED — the services SAM can read, on the desktop.
//
// The phone got GitHub first (4e7f307) and the Mac app got nothing, which is backwards: the
// desktop is where you have the room to actually look at a list, and it is the ONLY place the
// token can be pasted (every credential write is loopback-gated). So this pane both browses and
// tells you exactly what is missing.
//
// One row shape, no per-service branches — /api/connectors/:id/:kind answers { rows } for every
// service, which is the whole reason the dispatcher exists.

const ICONS: Record<string, IconName> = { github: "branch", slack: "chat", notion: "doc", linear: "grid", vercel: "cloud" };

/** Where we are: nothing (the service list), or a list, or a list drilled into from a row. */
type Crumb = { id: string; kind: string; label: string; param?: string; drill?: string };

export default function ConnectorsPane({ onClose, onPick }: { onClose: () => void; onPick?: (text: string) => void }) {
  const [conns, setConns] = useState<ConnectorStatus[] | null>(null);
  const [path, setPath] = useState<Crumb[]>([]);
  const [rows, setRows] = useState<ConnectorRow[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  const load = useCallback((refresh = false) => {
    setConns(null);
    // An empty array renders as "no connectors are set up" — a claim, not an absence of one. A
    // refusal (this pane is canReadPrivate) is a different fact and gets said, so nobody goes
    // looking for a Slack token they already added. Same distinction the row-level catch below
    // already drew; the list-level one had not.
    getConnectors(refresh).then((c) => { setConns(c); setErr(""); })
      .catch((e: any) => { setConns([]); setErr(e?.locked ? "This browser isn't paired with SAM — pair it to see your connected services." : e?.message || "Couldn't read your connectors."); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const here = path[path.length - 1];
  const conn = here ? conns?.find((c) => c.id === here.id) : undefined;

  // Re-fetch whenever the crumb changes — including when Back pops one, so returning to a list
  // shows it again rather than the rows of the level you just left.
  useEffect(() => {
    if (!here) { setRows(null); setErr(""); return; }
    let live = true;
    setBusy(true); setErr(""); setRows(null);
    getConnectorRows(here.id, here.kind, here.param)
      .then((r) => { if (live) setRows(r); })
      .catch((e) => { if (live) setErr(e?.message || "could not read that"); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [here]);

  function open(c: ConnectorStatus, l: ConnectorList) {
    setPath([{ id: c.id, kind: l.kind, label: l.label, drill: l.drill }]);
  }

  function tap(r: ConnectorRow) {
    // A row that drills opens the next list; a leaf row goes to the composer, which is what you
    // opened this pane to do — name a repo, a channel, a page, and ask SAM about it.
    if (here?.drill) {
      const target = conn?.lists.find((l) => l.kind === here.drill);
      setPath((p) => [...p, { id: here.id, kind: here.drill!, label: `${target?.label || here.drill} · ${r.title}`, param: r.id }]);
      return;
    }
    onPick?.(r.title);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer cx" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title"><Icon name="link" size={19} /> {here ? here.label : "Connected"}</div>
            <div className="drawer-sub">
              {here
                ? (busy ? "Reading…" : `${rows?.length ?? 0} from ${conn?.label || here.id}`)
                : "What SAM can read on your behalf — all of it read-only"}
            </div>
          </div>
          <div className="cx-head-acts">
            {path.length > 0 && (
              <button type="button" className="cx-back" onClick={() => setPath((p) => p.slice(0, -1))}>‹ Back</button>
            )}
            {path.length === 0 && (
              <button type="button" className="icon-btn" onClick={() => load(true)} aria-label="Check again"><Icon name="refresh" size={16} /></button>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
          </div>
        </div>

        {/* ── a list's rows ── */}
        {here && (
          <div className="cx-rows">
            {err && <div className="cx-err"><Icon name="warn" size={15} /> {err}</div>}
            {!busy && !err && rows?.length === 0 && (
              <div className="cx-empty">
                Nothing here.
                {conn?.id === "notion" && " A Notion integration only sees pages you've shared with it."}
              </div>
            )}
            {rows?.map((r) => (
              <div key={r.id + r.title} className="cx-row">
                <button type="button" className="cx-row-main" onClick={() => tap(r)}>
                  <span className="cx-row-title">{r.title}</span>
                  {r.sub && <span className="cx-row-sub">{r.sub}</span>}
                </button>
                {r.url && (
                  <a className="icon-btn" href={r.url} target="_blank" rel="noreferrer" aria-label="Open in browser" title={r.url}>
                    <Icon name="globe" size={14} />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── the services ── */}
        {!here && (
          <div className="cx-list">
            {conns === null && <div className="cx-empty">Checking…</div>}
            {conns?.map((c) => (
              <div key={c.id} className={"cx-card" + (c.connected ? " on" : "")}>
                <div className="cx-card-head">
                  <Icon name={ICONS[c.id] || "link"} size={17} />
                  <span className="cx-name">{c.label}</span>
                  <span className={"cx-state" + (c.connected ? " ok" : c.needsToken ? " todo" : " bad")}>
                    {c.connected ? c.detail || "connected" : c.needsToken ? "not connected" : "unreachable"}
                  </span>
                </div>
                {c.connected ? (
                  <div className="cx-lists">
                    {c.lists.map((l) => (
                      <button type="button" key={l.kind} className="cx-open" onClick={() => open(c, l)}>
                        <span className="cx-open-name">{l.label}</span>
                        <span className="cx-open-hint">{l.hint}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  // Never just "not connected": say what it would give you, where the token comes
                  // from, and that it can only be pasted here — a phone gets 403 on that write.
                  <div className="cx-off">
                    <div className="cx-off-note">{c.error || c.note}</div>
                    <div className="cx-off-how">
                      Paste a token in <strong>Settings → 3rd-Party Integrations</strong>, on this computer.
                      {" "}<a href={c.url.startsWith("http") ? c.url : undefined} target="_blank" rel="noreferrer">{c.url}</a>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
