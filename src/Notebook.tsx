import { useState, useEffect, useRef } from "react";
import { listNotebooks, createNotebook, notebookSources, addNotebookSource, askNotebook, notebookAudio, deleteNotebook } from "./lib/api";
import { renderMarkdown } from "./lib/md";
import { useEscape } from "./lib/useOverlay";
import Icon from "./Icon";

type NB = { id: string; title: string; sources: number; chunks: number };
type Source = { source: string; title: string; chunks: number };
type Turn = { q: string; a: string; citations: string[]; loading?: boolean };

// NotebookLM, in SAM: pick/create a notebook, add sources (web / file / text),
// then ask questions answered ONLY from those sources — with citations — or generate
// a two-host "Audio Overview" podcast of the material.
export default function Notebook({ onClose, speak }: { onClose: () => void; speak?: (t: string) => void }) {
  useEscape(onClose);
  const [books, setBooks] = useState<NB[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState("");        // the URL/text being added
  const [addMode, setAddMode] = useState<"url" | "text">("url");
  const [busy, setBusy] = useState("");
  const [audio, setAudio] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  const activeBook = books.find((b) => b.id === active);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh once on mount
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (active) notebookSources(active).then((r) => setSources(r.sources || [])).catch(() => {/* audio playback is optional — never surface a chime failure */}); setTurns([]); setAudio(""); }, [active]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to newest on turns change
  useEffect(() => { chatRef.current?.scrollTo(0, chatRef.current.scrollHeight); }, [turns]);

  function refresh() { listNotebooks().then((r) => { setBooks(r.notebooks || []); if (!active && r.notebooks?.[0]) setActive(r.notebooks[0].id); }).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */}); }

  async function newBook() {
    const title = window.prompt("Name this notebook (e.g. 'Competitor research')");
    if (!title?.trim()) return;
    const n = await createNotebook(title.trim());
    await refresh(); setActive(n.id);
  }

  async function addSource() {
    if (!active || !adding.trim()) return;
    setBusy("Adding source…");
    const body = addMode === "url" ? { url: adding.trim() } : { text: adding.trim(), title: "Pasted note" };
    const r = await addNotebookSource(active, body).catch(() => ({ ok: false, error: "failed" }));
    setBusy("");
    if (r.ok) { setAdding(""); notebookSources(active).then((x) => setSources(x.sources || [])); refresh(); }
    else setBusy(r.error || "Couldn't add that source");
  }

  async function ask() {
    if (!active || !q.trim() || busy) return;
    const question = q.trim(); setQ("");
    setTurns((t) => [...t, { q: question, a: "", citations: [], loading: true }]);
    const r = await askNotebook(active, question).catch(() => ({ answer: "Something went wrong.", citations: [] }));
    setTurns((t) => t.map((x, i) => i === t.length - 1 ? { q: question, a: r.answer, citations: r.citations || [] } : x));
  }

  async function makeAudio() {
    if (!active || busy) return;
    setBusy("Producing audio overview…"); setAudio("");
    const r = await notebookAudio(active).catch(() => ({ script: "" }));
    setBusy("");
    setAudio(r.script || "No material yet — add sources first.");
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer notebook-drawer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="notebook">
        <div className="nb-head">
          <span className="nb-title"><Icon name="book" size={17} /> Notebooks</span>
          <span className="nb-sub">Grounded, cited</span>
          <button type="button" className="nb-x" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>

        <div className="nb-body">
          {/* LEFT — notebooks + sources */}
          <div className="nb-side">
            <div className="nb-books">
              {books.map((b) => (
                <button type="button" key={b.id} className={`nb-book ${b.id === active ? "on" : ""}`} onClick={() => setActive(b.id)}>
                  <span className="nb-book-name">{b.title}</span>
                  <span className="nb-book-meta">{b.sources} src</span>
                </button>
              ))}
              <button type="button" className="nb-book nb-new" onClick={newBook}><Icon name="plus" size={15} /> New notebook</button>
            </div>

            {active && (
              <div className="nb-sources">
                <div className="nb-side-label">Sources</div>
                {sources.length === 0 && <div className="nb-empty">No sources yet — add a link or paste text below.</div>}
                {sources.map((s, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: render-only source list; order is stable
                  <div key={i} className="nb-source" title={s.source}>
                    <span className="nb-source-ic"><Icon name={/^https?:/.test(s.source) ? "globe" : "doc"} size={14} /></span>
                    <span className="nb-source-t">{s.title}</span>
                  </div>
                ))}
                <div className="nb-add">
                  <div className="nb-add-tabs">
                    <button type="button" className={addMode === "url" ? "on" : ""} onClick={() => setAddMode("url")}><Icon name="globe" size={14} /> Link</button>
                    <button type="button" className={addMode === "text" ? "on" : ""} onClick={() => setAddMode("text")}><Icon name="pencil" size={14} /> Text</button>
                  </div>
                  {addMode === "url"
                    ? <input className="nb-add-in" placeholder="Paste a URL…" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSource()} />
                    : <textarea className="nb-add-in" placeholder="Paste text / notes…" value={adding} onChange={(e) => setAdding(e.target.value)} rows={3} />}
                  <button type="button" className="nb-add-btn" onClick={addSource} disabled={!adding.trim()}>Add source</button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — grounded chat + audio */}
          <div className="nb-main">
            {!active ? (
              <div className="nb-welcome"><b>Create a notebook</b> to begin. Drop in web pages, files or notes, then ask questions answered only from those sources — every claim cited.</div>
            ) : (
              <>
                <div className="nb-main-bar">
                  <span>{activeBook?.title} · {activeBook?.sources || 0} sources</span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button type="button" className="nb-audio-btn" onClick={makeAudio} disabled={!!busy}><Icon name="voice" size={14} /> Audio Overview</button>
                    <button type="button" className="nb-del" aria-label="Delete notebook" onClick={async () => { if (window.confirm(`Delete notebook "${activeBook?.title}"?`)) { await deleteNotebook(active); setActive(null); refresh(); } }}><Icon name="trash" size={15} /></button>
                  </div>
                </div>

                <div className="nb-chat" ref={chatRef}>
                  {turns.length === 0 && !audio && <div className="nb-empty" style={{ padding: 24 }}>Ask anything about your sources. Every answer is cited.</div>}
                  {audio && (
                    <div className="nb-audio">
                      <div className="nb-audio-head"><Icon name="voice" size={15} /> Audio Overview <button type="button" className="nb-play" onClick={() => speak?.(audio.replace(/^(Alex|Sam):/gm, ""))}><Icon name="play" size={13} /> Play</button></div>
                      <div className="nb-audio-script" dangerouslySetInnerHTML={{ __html: renderMarkdown(audio) }} />
                    </div>
                  )}
                  {turns.map((t, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: render-only turn list; order is stable
                    <div key={i} className="nb-turn">
                      <div className="nb-q">{t.q}</div>
                      <div className="nb-a">
                        {t.loading ? <span className="nb-typing">Reading sources…</span> : <div dangerouslySetInnerHTML={{ __html: renderMarkdown(t.a) }} />}
                        {t.citations.length > 0 && <div className="nb-cites"><Icon name="link" size={13} /> {t.citations.slice(0, 6).join(" · ")}</div>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="nb-composer">
                  <input placeholder="Ask your sources…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} />
                  <button type="button" onClick={ask} disabled={!q.trim() || !!busy}>Ask</button>
                </div>
              </>
            )}
            {busy && <div className="nb-busy">{busy}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
