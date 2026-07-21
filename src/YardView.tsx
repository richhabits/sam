import { useEffect, useMemo, useState } from "react";
import { getYardProjects, getYardProject, getYardProjectFile, yardPreviewUrl } from "./lib/api";

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

type Tab = "preview" | "files" | "history" | "brief";

export default function YardView() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [slug, setSlug] = useState<string>("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [openFile, setOpenFile] = useState<{ path: string; text: string } | null>(null);
  const [device, setDevice] = useState<"phone" | "desktop">("desktop");
  const [nonce, setNonce] = useState(0);   // forces the preview to re-fetch after a rebuild

  useEffect(() => { document.title = "The Yard · SAM"; }, []);

  useEffect(() => {
    getYardProjects()
      .then((r) => {
        const list: Project[] = r?.projects ?? [];
        setProjects(list);
        setSlug((s) => s || list[0]?.slug || "");
      })
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!slug) return;
    setDetail(null); setOpenFile(null);
    getYardProject(slug).then(setDetail).catch(() => setDetail(null));
  }, [slug]);

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
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "18px 16px 60px" }}>
        {/* masthead */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.03em" }}>The Yard</div>
            <div style={{ fontSize: 12, color: "var(--ash)" }}>what SAM has built · looking only</div>
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
            <button type="button" onClick={back} style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--paper)", borderRadius: 9, padding: "8px 12px", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>← SAM</button>
          </div>
        </div>

        {projects === null ? (
          <div style={{ ...card, textAlign: "center", padding: 40, color: "var(--ash)" }}>Looking…</div>
        ) : !projects.length ? (
          <div style={{ ...card, textAlign: "center", padding: 44 }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Nothing built yet</div>
            <div style={{ color: "var(--ash)", fontSize: 13.5, lineHeight: 1.6 }}>
              Ask SAM in chat — <i>“build me a one-page site for…”</i> — and it will appear here.
              {" "}Projects live in <code>~/SAMYard/projects</code>.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
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
              <button type="button" style={tabBtn("history")} onClick={() => setTab("history")}>History</button>
              <button type="button" style={tabBtn("brief")} onClick={() => setTab("brief")}>Brief</button>
            </div>

            {tab === "preview" && (
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
                  <span style={{ ...lbl, margin: 0 }}>The page as it actually renders</span>
                  <span style={{ display: "flex", gap: 6 }}>
                    {(["phone", "desktop"] as const).map((d) => (
                      <button key={d} type="button" onClick={() => setDevice(d)}
                        style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 999, cursor: "pointer", fontWeight: 700,
                          border: `1px solid ${device === d ? "var(--accent)" : "var(--line)"}`,
                          background: device === d ? "var(--accent-soft)" : "transparent",
                          color: device === d ? "var(--accent)" : "var(--ash)" }}>{d}</button>
                    ))}
                    <button type="button" onClick={() => setNonce((n) => n + 1)}
                      style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 999, border: "1px solid var(--line)", background: "transparent", color: "var(--ash)", cursor: "pointer" }}>reload</button>
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "center", background: "var(--ink-2)", borderRadius: 12, padding: 12, border: "1px solid var(--line)" }}>
                  <iframe
                    key={`${slug}-${nonce}`}
                    title={`${m?.name ?? slug} preview`}
                    src={`${yardPreviewUrl(slug)}?v=${nonce}`}
                    // The preview renders a page SAM's model wrote, so it is treated as
                    // untrusted: sandboxed, and pointed only at its own project's files.
                    sandbox="allow-scripts"
                    style={{ width: device === "phone" ? 390 : "100%", height: device === "phone" ? 700 : 620, border: "none", borderRadius: 8, background: "#fff" }}
                  />
                </div>
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
        )}
      </div>
    </div>
  );
}
