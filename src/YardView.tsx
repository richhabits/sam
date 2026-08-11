import { useEffect, useMemo, useRef, useState } from "react";
import { getYardProjects, getYardProject, getYardProjectFile, yardPreviewUrl, command, getYard, getYardJobDiffs } from "./lib/api";
import PairPrompt from "./PairPrompt";

// 🏗 THE YARD — what SAM has built. A full view, like the money desk, opened with ?app=yard.
//
// The yard could build, commit and deploy while SAM had no way to show you a single page
// it had made. This is that: the project, the page as it actually renders, the files, and
// the history of every checkpoint — so a build is something you can judge rather than
// something you have to take on trust.
//
// Read-only on purpose. Starting and stopping work lives in the Control Centre where the
// kill switch is; this is for looking at the result.

type Project = { slug: string; name: string; updatedAt: number };
type Checkpoint = { sha: string; message: string; at: string };
type Manifest = { slug: string; name: string; spec: string; decisions: any[]; todo: any[]; issues: string[]; createdAt: number; updatedAt: number };
type Detail = { manifest: Manifest; checkpoints: Checkpoint[]; files: { path: string; bytes: number }[]; path: string };

const palette = {
  "--ink": "#0E0F12", "--ink-2": "#141619", "--surface": "#181B1F", "--paper": "#ECEEF2",
  "--ash": "#9BA3AE", "--line": "rgba(124,158,255,.16)", "--accent": "#7C9EFF",
  "--accent-soft": "rgba(124,158,255,.12)", "--live": "#5FD08A", "--c-err": "#EF4444", "--gold": "#D8B26A",
} as React.CSSProperties;

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 16 };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ash)", margin: "0 0 10px" };

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const when = (iso: string) => { try { return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };

type Tab = "preview" | "files" | "diffs" | "history" | "brief";
type Device = "phone" | "tablet" | "desktop";

// What the preview posts back when you point at something. Anything can postMessage to a
// window, so a message without this marker — or from a window that is not the frame on
// screen — is noise from somewhere else and is ignored.
const GLASS_SOURCE = "sam-glass";
type Picked = { selector: string; tag: string; text: string };

type FileDiff = {
  path: string; kind: "added" | "removed" | "modified"; truncated: boolean;
  addedLines: number; removedLines: number;
  hunks: { at: number; removed: string[]; added: string[] }[];
};

const DEVICE_WIDTH: Record<Device, number | string> = { phone: 390, tablet: 834, desktop: "100%" };
const DEVICE_HEIGHT: Record<Device, number> = { phone: 700, tablet: 900, desktop: 620 };

export default function YardView() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [refused, setRefused] = useState(false);
  const [slug, setSlug] = useState<string>("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [openFile, setOpenFile] = useState<{ path: string; text: string } | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  // THE GLASS — pointing at the page instead of describing it. Off by default: in select
  // mode a click means "this is what I mean" rather than "follow this link", which is not
  // what you want when you are simply looking at the thing.
  const [pointing, setPointing] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [nonce, setNonce] = useState(0);   // forces the preview to re-fetch after a rebuild
  // The builder half: say what to change, watch it happen, see the page update.
  const [split, setSplit] = useState(true);
  const [said, setSaid] = useState<{ who: "you" | "sam"; text: string }[]>([]);
  const [asking, setAsking] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = "The Yard · SAM"; }, []);

  useEffect(() => {
    getYardProjects()
      .then((r) => {
        setRefused(false);
        const list: Project[] = r?.projects ?? [];
        setProjects(list);
        setSlug((s) => s || list[0]?.slug || "");
      })
      // Same as Tasks and the device list: /api/yard/projects refuses with a 403, never with a
      // `refused` field, so this view answered "no projects" to a browser that simply was not
      // allowed to look. An empty list and a closed door should not render as the same sentence.
      .catch((e: any) => {
        setProjects([]);
        if (e?.locked || e?.status === 401 || e?.status === 403) setRefused(true);
      });
  }, []);

  useEffect(() => {
    if (!slug) return;
    setDetail(null); setOpenFile(null);
    getYardProject(slug).then(setDetail).catch(() => setDetail(null));
  }, [slug]);

  // What the preview says when you point at something. The preview is served in an
  // OPAQUE origin (its CSP sandboxes it), so its messages have no useful origin to check
  // against — the identity that matters is that the message came from the frame on
  // screen, which is what is checked here.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== "object" || d.source !== GLASS_SOURCE) return;
      const sel = String(d.selector || "");
      if (!sel) return;
      setPicked({ selector: sel, tag: String(d.tag || ""), text: String(d.text || "") });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Pointing at something only makes sense while the picker is being served. Turning it
  // off clears what was picked, so the composer can never quietly carry a selector for a
  // page you are no longer pointing at.
  useEffect(() => { if (!pointing) setPicked(null); }, [pointing]);

  // The diffs of the most recent job for this project. Loaded on demand rather than with
  // the project, because it is the one tab that is usually not being looked at.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is not read in here — it is a deliberate re-run trigger. It bumps when a build lands, and that is exactly when these diffs are stale.
  useEffect(() => {
    if (tab !== "diffs" || !slug) return;
    setDiffs(null);
    getYard()
      .then(async (y: any) => {
        const mine = (y?.recent ?? []).filter((j: any) => j?.project === slug);
        if (!mine.length) { setDiffs([]); return; }
        const r: any = await getYardJobDiffs(mine[0].id);
        setDiffs(r?.diffs ?? []);
      })
      .catch(() => setDiffs([]));
  }, [tab, slug, nonce]);

  // Send a change scoped to THIS project, so the request never has to name it and can
  // never be pointed at the wrong one by a loose phrase.
  const ask = async () => {
    const text = asking.trim();
    if (!text || busy) return;
    setAsking(""); setBusy(true);
    setSaid((s) => [...s, { who: "you", text }]);
    try {
      // A picked element makes the request name the thing exactly instead of describing
      // it — the difference between steering a build and negotiating with one.
      const aimed = picked
        ? `${text} — change the element matching the CSS selector \`${picked.selector}\`${picked.text ? ` (currently reads "${picked.text}")` : ""}`
        : text;
      const named = m?.name && aimed.toLowerCase().includes(m.name.toLowerCase()) ? aimed : `${aimed} — on the ${m?.name ?? slug}`;
      const r: any = await command(named);
      setSaid((s) => [...s, { who: "sam", text: String(r?.reply ?? r?.text ?? "…").split("\n")[0] }]);
    } catch {
      setSaid((s) => [...s, { who: "sam", text: "That didn't reach SAM — is it still running?" }]);
    }
  };

  // While something is building, watch the queue and refresh the moment it lands. The
  // whole point of a split view is not having to ask whether it worked.
  useEffect(() => {
    if (!busy) return;
    const iv = setInterval(() => {
      getYard().then((y: any) => {
        if (y?.running === 0 && y?.depth === 0) {
          setBusy(false);
          setNonce((n) => n + 1);                                  // repaint the preview
          getYardProject(slug).then(setDetail).catch(() => {/* keeps what it had */});
          setSaid((s) => [...s, { who: "sam", text: "Done — the preview has been refreshed." }]);
        }
      }).catch(() => setBusy(false));
    }, 3000);
    const giveUp = setTimeout(() => setBusy(false), 5 * 60_000);
    return () => { clearInterval(iv); clearTimeout(giveUp); };
  }, [busy, slug]);

  const back = () => {
    const sd = (globalThis as any).samDesktop;
    if (sd?.close) sd.close(); else window.close();
    if (!window.closed) location.href = location.pathname;
  };

  const wrap: React.CSSProperties = {
    ...palette, minHeight: "100vh",
    background: "radial-gradient(900px 460px at 50% -12%, rgba(124,158,255,.10), transparent 62%), var(--ink)",
    color: "var(--paper)", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
    WebkitFontSmoothing: "antialiased",
  };

  const tabBtn = (t: Tab): React.CSSProperties => ({
    flex: 1, padding: "8px 8px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
    background: tab === t ? "var(--surface)" : "transparent", color: tab === t ? "var(--paper)" : "var(--ash)",
  });

  const m = detail?.manifest;
  const files = useMemo(() => detail?.files ?? [], [detail]);

  return (
    <div style={wrap}>
      <div style={{ maxWidth: split ? 1560 : 1180, margin: "0 auto", padding: "18px 16px 60px" }}>
        {/* masthead */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.03em" }}>The Yard</div>
            <div style={{ fontSize: 12, color: "var(--ash)" }}>{split ? "say what to change · watch it happen" : "what SAM has built"}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!!projects?.length && (
              <select
                value={slug} onChange={(e) => setSlug(e.target.value)}
                style={{ background: "var(--surface)", color: "var(--paper)", border: "1px solid var(--line)", borderRadius: 9, padding: "7px 10px", fontSize: 13, maxWidth: 260 }}
              >
                {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </select>
            )}
            <button type="button" onClick={() => setSplit((v) => !v)}
              style={{ background: split ? "var(--accent-soft)" : "var(--surface)", border: `1px solid ${split ? "var(--accent)" : "var(--line)"}`, color: split ? "var(--accent)" : "var(--ash)", borderRadius: 9, padding: "8px 12px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              {split ? "Builder" : "Builder off"}
            </button>
            <button type="button" onClick={back} style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--paper)", borderRadius: 9, padding: "8px 12px", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>← SAM</button>
          </div>
        </div>

        {projects === null ? (
          <div style={{ ...card, textAlign: "center", padding: 40, color: "var(--ash)" }}>Looking…</div>
        ) : refused ? (
          // Refused is not empty. Saying "nothing built yet" while projects sit on disk
          // sends you looking for a bug that is not there.
          <div style={{ ...card, textAlign: "center", padding: 44 }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>This browser isn't paired yet</div>
            <div style={{ color: "var(--ash)", fontSize: 13.5, lineHeight: 1.6, marginBottom: 14 }}>
              The yard is there — the read was refused, not empty. Pair this browser once and it
              works from any tab.
            </div>
            <PairPrompt />
          </div>
        ) : !projects.length ? (
          <div style={{ ...card, textAlign: "center", padding: 44 }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Nothing built yet</div>
            <div style={{ color: "var(--ash)", fontSize: 13.5, lineHeight: 1.6 }}>
              Ask SAM in chat — <i>“build me a one-page site for…”</i> — and it will appear here.
              {" "}Projects live in <code>~/SAMYard/projects</code>.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: split ? "minmax(300px, 380px) 1fr" : "1fr", alignItems: "start" }}>
            {/* ── THE BUILDER ──────────────────────────────────────────────
                Describe a change, and the page beside it updates when the job
                lands. The request is scoped to the project on screen, so it never
                has to name it — and can never be pointed at the wrong one by a
                loose phrase. */}
            {split && (
              <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 18, maxHeight: "calc(100vh - 60px)" }}>
                <div style={lbl}>Change this project</div>
                <div style={{ flex: 1, overflowY: "auto", display: "grid", gap: 8, minHeight: 120 }}>
                  {!said.length && (
                    <div style={{ fontSize: 13, color: "var(--ash)", lineHeight: 1.6 }}>
                      Try <i>“make the heading gold”</i> or <i>“add a contact section”</i>.
                      <br /><br />
                      Every change checkpoints first, so there is always a way back.
                    </div>
                  )}
                  {said.map((t) => (
                    <div key={`${t.who}-${t.text}`} style={{
                      fontSize: 13, lineHeight: 1.5, padding: "8px 10px", borderRadius: 10,
                      background: t.who === "you" ? "var(--accent-soft)" : "var(--ink-2)",
                      color: t.who === "you" ? "var(--accent)" : "var(--paper)",
                      justifySelf: t.who === "you" ? "end" : "start", maxWidth: "92%",
                    }}>{t.text}</div>
                  ))}
                  {busy && <div style={{ fontSize: 12, color: "var(--ash)" }}>building… the preview refreshes on its own</div>}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={asking} onChange={(e) => setAsking(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                    placeholder={busy ? "building…" : "what should change?"}
                    disabled={busy}
                    style={{ flex: 1, background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--paper)", borderRadius: 9, padding: "9px 11px", fontSize: 13 }}
                  />
                  <button type="button" onClick={ask} disabled={busy || !asking.trim()}
                    style={{ background: busy || !asking.trim() ? "var(--ink-2)" : "var(--accent)", color: busy || !asking.trim() ? "var(--ash)" : "#0E0F12", border: "none", borderRadius: 9, padding: "9px 14px", fontWeight: 800, fontSize: 13, cursor: busy || !asking.trim() ? "default" : "pointer" }}>
                    Go
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
            {/* what this project is */}
            <div style={{ ...card, background: "linear-gradient(150deg, rgba(124,158,255,.08), var(--surface) 55%)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>{m?.name ?? slug}</div>
                <div style={{ fontSize: 12, color: "var(--ash)" }}>
                  {detail ? `${detail.checkpoints.length} checkpoint${detail.checkpoints.length === 1 ? "" : "s"} · ${files.length} file${files.length === 1 ? "" : "s"}` : "…"}
                </div>
              </div>
              {m?.spec && <div style={{ fontSize: 13.5, color: "var(--ash)", marginTop: 6 }}>{m.spec}</div>}
              {/* Known problems are shown, not buried — an issue nobody sees is one that did not get fixed. */}
              {!!m?.issues?.length && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--c-err)" }}>
                  {m.issues.map((i) => <div key={i}>⚠ {i}</div>)}
                </div>
              )}
              {detail && <div style={{ fontSize: 11, color: "var(--ash)", marginTop: 10, fontFamily: "ui-monospace,Menlo,monospace", wordBreak: "break-all" }}>{detail.path}</div>}
            </div>

            {/* tabs */}
            <div style={{ display: "flex", gap: 4, background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 12, padding: 4 }}>
              <button type="button" style={tabBtn("preview")} onClick={() => setTab("preview")}>Preview</button>
              <button type="button" style={tabBtn("files")} onClick={() => setTab("files")}>Files</button>
              <button type="button" style={tabBtn("diffs")} onClick={() => setTab("diffs")}>Diffs</button>
              <button type="button" style={tabBtn("history")} onClick={() => setTab("history")}>History</button>
              <button type="button" style={tabBtn("brief")} onClick={() => setTab("brief")}>Brief</button>
            </div>

            {tab === "preview" && (
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
                  <span style={{ ...lbl, margin: 0 }}>The page as it actually renders</span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["phone", "tablet", "desktop"] as const).map((d) => (
                      <button key={d} type="button" onClick={() => setDevice(d)}
                        style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 999, cursor: "pointer", fontWeight: 700,
                          border: `1px solid ${device === d ? "var(--accent)" : "var(--line)"}`,
                          background: device === d ? "var(--accent-soft)" : "transparent",
                          color: device === d ? "var(--accent)" : "var(--ash)" }}>{d}</button>
                    ))}
                    <button type="button" onClick={() => setPointing((v) => !v)}
                      title="Click something in the page to aim your next change at it"
                      style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 999, cursor: "pointer", fontWeight: 700,
                        border: `1px solid ${pointing ? "var(--gold)" : "var(--line)"}`,
                        background: pointing ? "rgba(216,178,106,.14)" : "transparent",
                        color: pointing ? "var(--gold)" : "var(--ash)" }}>{pointing ? "pointing" : "point"}</button>
                    <button type="button" onClick={() => setNonce((n) => n + 1)}
                      style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 999, border: "1px solid var(--line)", background: "transparent", color: "var(--ash)", cursor: "pointer" }}>reload</button>
                  </span>
                </div>

                {/* What you are aiming at. Shown here rather than only in the composer,
                    because it is a property of the PAGE — and it must be obvious that a
                    change is about to be aimed somewhere specific. */}
                {pointing && (
                  <div style={{ marginBottom: 10, fontSize: 12.5, color: picked ? "var(--gold)" : "var(--ash)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {picked ? (
                      <>
                        <span>aiming at <code style={{ fontFamily: "ui-monospace,Menlo,monospace" }}>{picked.selector}</code>{picked.text ? ` — “${picked.text}”` : ""}</span>
                        <button type="button" onClick={() => setPicked(null)}
                          style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--line)", background: "transparent", color: "var(--ash)", cursor: "pointer" }}>clear</button>
                      </>
                    ) : <span>click anything in the page below to aim your next change at it</span>}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "center", background: "var(--ink-2)", borderRadius: 12, padding: 12, border: "1px solid var(--line)" }}>
                  <iframe
                    ref={frame}
                    key={`${slug}-${nonce}-${pointing ? "point" : "look"}`}
                    title={`${m?.name ?? slug} preview`}
                    // select=1 asks the server to inject the picker. It is opt-in per
                    // request, so what ships is never the page with SAM's script in it.
                    src={`${yardPreviewUrl(slug)}?v=${nonce}${pointing ? "&select=1" : ""}`}
                    // The preview renders a page SAM's model wrote, so it is treated as
                    // untrusted: sandboxed, and pointed only at its own project's files.
                    sandbox="allow-scripts"
                    style={{ width: DEVICE_WIDTH[device], maxWidth: "100%", height: DEVICE_HEIGHT[device], border: "none", borderRadius: 8, background: "#fff" }}
                  />
                </div>
              </div>
            )}

            {/* ── DIFFS ────────────────────────────────────────────────────
                The build loop applies its own edits, which is the right default —
                asking permission per line is what makes a builder tiring. What it
                owes you in return is a record: exactly what changed, from the last
                job that changed anything on this project. */}
            {tab === "diffs" && (
              <div style={card}>
                <div style={lbl}>What the last build changed</div>
                {diffs === null ? (
                  <div style={{ color: "var(--ash)", fontSize: 13 }}>Looking…</div>
                ) : !diffs.length ? (
                  <div style={{ color: "var(--ash)", fontSize: 13, lineHeight: 1.6 }}>
                    No recorded changes yet. Diffs are kept for build-loop jobs — a change made
                    another way still checkpoints, so History is the way back for those.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {diffs.map((d) => (
                      <div key={d.path} style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 10px", background: "var(--ink-2)", fontSize: 12.5, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "ui-monospace,Menlo,monospace" }}>{d.path}</span>
                          <span style={{ color: "var(--ash)" }}>
                            {d.kind === "added" ? "new file" : d.kind === "removed" ? "emptied" : (
                              <>
                                <span style={{ color: "var(--live)" }}>+{d.addedLines}</span>{" "}
                                <span style={{ color: "var(--c-err)" }}>−{d.removedLines}</span>
                              </>
                            )}
                          </span>
                        </div>
                        {d.truncated ? (
                          <div style={{ padding: "8px 10px", fontSize: 12.5, color: "var(--ash)" }}>Too large to show line by line ({d.addedLines} lines).</div>
                        ) : (
                          <div style={{ padding: "6px 0", fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12, overflowX: "auto" }}>
                            {d.hunks.map((h) => (
                              <div key={`${d.path}-${h.at}`} style={{ padding: "4px 0" }}>
                                <div style={{ color: "var(--ash)", padding: "0 10px 2px" }}>line {h.at + 1}</div>
                                {/* The position IS the identity here: a hunk is a fixed,
                                    never-reordered list in which two lines can legitimately
                                    be byte-identical (two blank lines, two closing braces). */}
                                {h.removed.map((l, i) => (
                                  // biome-ignore lint/suspicious/noArrayIndexKey: static, never-reordered list where duplicate lines are expected
                                  <div key={`r${h.at}-${i}`} style={{ padding: "0 10px", whiteSpace: "pre", color: "var(--c-err)", background: "rgba(239,68,68,.07)" }}>− {l}</div>
                                ))}
                                {h.added.map((l, i) => (
                                  // biome-ignore lint/suspicious/noArrayIndexKey: static, never-reordered list where duplicate lines are expected
                                  <div key={`a${h.at}-${i}`} style={{ padding: "0 10px", whiteSpace: "pre", color: "var(--live)", background: "rgba(95,208,138,.07)" }}>+ {l}</div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "files" && (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={card}>
                  <div style={lbl}>Files</div>
                  <div style={{ display: "grid", gap: 2 }}>
                    {files.map((f) => (
                      <button key={f.path} type="button"
                        onClick={() => getYardProjectFile(slug, f.path).then((r) => setOpenFile({ path: f.path, text: r?.text ?? "(not readable as text)" })).catch(() => {/* the row simply does not open */})}
                        style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 8px", borderRadius: 7, cursor: "pointer",
                          border: "none", textAlign: "left", fontSize: 13,
                          background: openFile?.path === f.path ? "var(--accent-soft)" : "transparent",
                          color: openFile?.path === f.path ? "var(--accent)" : "var(--paper)" }}>
                        <span style={{ fontFamily: "ui-monospace,Menlo,monospace" }}>{f.path}</span>
                        <span style={{ color: "var(--ash)", fontSize: 12 }}>{bytes(f.bytes)}</span>
                      </button>
                    ))}
                    {!files.length && <div style={{ color: "var(--ash)", fontSize: 13 }}>No files yet.</div>}
                  </div>
                </div>
                {openFile && (
                  <div style={card}>
                    <div style={lbl}>{openFile.path}</div>
                    <pre style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace,Menlo,monospace", color: "var(--paper)", opacity: .9, maxHeight: 460, overflow: "auto" }}>
                      {openFile.text}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {tab === "history" && (
              <div style={card}>
                <div style={lbl}>Every checkpoint · newest first</div>
                <div style={{ display: "grid", gap: 2 }}>
                  {(detail?.checkpoints ?? []).map((c, i) => (
                    <div key={c.sha} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "8px 0", borderBottom: i === (detail?.checkpoints.length ?? 0) - 1 ? "none" : "1px solid var(--line)" }}>
                      <span style={{ fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12, color: i === 0 ? "var(--gold)" : "var(--ash)", minWidth: 66 }}>{c.sha.slice(0, 8)}</span>
                      <span style={{ flex: 1, fontSize: 13.5 }}>{c.message}</span>
                      <span style={{ fontSize: 12, color: "var(--ash)", whiteSpace: "nowrap" }}>{when(c.at)}</span>
                    </div>
                  ))}
                  {!detail?.checkpoints.length && <div style={{ color: "var(--ash)", fontSize: 13 }}>No history yet.</div>}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ash)", marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                  Every finished step commits itself, so any of these is a way back. Ask SAM in chat to restore one.
                </div>
              </div>
            )}

            {tab === "brief" && (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={card}>
                  <div style={lbl}>What it is for</div>
                  <div style={{ fontSize: 14, lineHeight: 1.6 }}>{m?.spec || "No brief was recorded."}</div>
                </div>
                {!!m?.decisions?.length && (
                  <div style={card}>
                    <div style={lbl}>Decisions taken</div>
                    {m.decisions.map((d: any) => <div key={d.note} style={{ fontSize: 13.5, marginBottom: 6 }}>· {d.note}</div>)}
                  </div>
                )}
                {!!m?.todo?.length && (
                  <div style={card}>
                    <div style={lbl}>Still to do</div>
                    {m.todo.map((t: any) => (
                      <div key={t.note} style={{ fontSize: 13.5, marginBottom: 6, color: t.done ? "var(--ash)" : "var(--paper)", textDecoration: t.done ? "line-through" : "none" }}>
                        {t.done ? "✓" : "○"} {t.note}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: "var(--ash)", textAlign: "center" }}>
                  This is the project's own record, carried between sessions.
                </div>
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
