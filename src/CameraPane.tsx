import { useEffect, useState } from "react";
import { getCameras, addCameraApi, removeCameraApi } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// 📷 The Watch — cameras on YOUR network only. Nursery / dog / doorway. SAM refuses anything not on
// your LAN, records nothing, uploads nothing, stores no credentials. Ring/cloud cams need your login
// and aren't wired — they're placeholders here until you connect an adapter yourself.

type Camera = { id: string; name: string; location?: string; kind: "snapshot" | "rtsp" | "ring"; url?: string };
type Kind = Camera["kind"];

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: "snapshot", label: "Snapshot (HTTP)", hint: "a still-image url your camera serves, e.g. http://192.168.1.42/snapshot.jpg" },
  { id: "rtsp", label: "Stream (RTSP)", hint: "an rtsp:// stream on your network (needs a viewer to play)" },
  { id: "ring", label: "Ring / cloud", hint: "placeholder only — connecting needs your login, which only you can do" },
];

export default function CameraPane({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [cams, setCams] = useState<Camera[]>([]);
  const [on, setOn] = useState(true);
  const [why, setWhy] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [kind, setKind] = useState<Kind>("snapshot");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);   // forces snapshot <img> refresh

  const load = () => getCameras().then((d) => { setCams(d.cameras || []); setOn(d.on !== false); setWhy(d.why || ""); }).catch(() => setErr("Couldn't load cameras."));
  // biome-ignore lint/correctness/useExhaustiveDependencies: load + tick on mount; load is stable
  useEffect(() => { load(); const t = setInterval(() => setTick((n) => n + 1), 5000); return () => clearInterval(t); }, []);

  const add = async () => {
    setErr("");
    if (!name.trim()) { setErr("Give the camera a name."); return; }
    setBusy(true);
    try {
      const r = await addCameraApi({ name: name.trim(), location: location.trim() || undefined, kind, url: url.trim() || undefined });
      if (r?.error) setErr(r.error); else { setName(""); setLocation(""); setUrl(""); load(); }
    } catch { setErr("Couldn't add that camera."); } finally { setBusy(false); }
  };
  const del = async (id: string) => { await removeCameraApi(id).catch(() => undefined); load(); };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer" onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 96vw)" }}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">📷 Cameras</div>
            <div className="drawer-sub">Cameras on <b>your own network</b> — nursery, dog, doorway. Local-only: nothing is recorded, uploaded, or sent anywhere.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ padding: "6px 20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          {!on && <div style={{ fontSize: 13, padding: "10px 13px", borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent-text)" }}>{why || "Cameras are off."}</div>}

          {/* Live grid */}
          {cams.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {cams.map((c) => (
                <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--bg)" }}>
                  <div style={{ aspectRatio: "16/10", background: "#000", display: "grid", placeItems: "center", position: "relative" }}>
                    {c.kind === "snapshot" && c.url
                      ? <img src={`${c.url}${c.url.includes("?") ? "&" : "?"}_t=${tick}`} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      : <span style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", padding: 10 }}>
                          {c.kind === "rtsp" ? "▶ RTSP stream — open in a player" : c.kind === "ring" ? "Ring — not linked (needs your login)" : "no preview"}
                        </span>}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "9px 11px" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                      {c.location && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{c.location}</div>}
                    </div>
                    <button type="button" onClick={() => del(c.id)} style={{ fontSize: 12, padding: "3px 9px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--c-err,#EF4444)", cursor: "pointer" }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 15, border: "1px solid var(--border)", borderRadius: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Add a camera</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name e.g. “Nursery”" style={{ ...inp, flex: 1 }} />
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room (optional)" style={{ ...inp, flex: 1 }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {KINDS.map((k) => <button key={k.id} type="button" onClick={() => setKind(k.id)} style={chip(kind === k.id)}>{k.label}</button>)}
            </div>
            {kind !== "ring"
              ? <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={kind === "rtsp" ? "rtsp://192.168.1.42:554/stream" : "http://192.168.1.42/snapshot.jpg"} style={inp} />
              : <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>Ring is a placeholder — SAM never enters your Ring login. Add it to plan your setup; wiring a cloud cam is a step only you can do.</div>}
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{KINDS.find((k) => k.id === kind)?.hint}</div>
            {err && <div style={{ color: "var(--c-err,#EF4444)", fontSize: 13 }}>{err}</div>}
            <button type="button" onClick={add} disabled={busy} className="dl-btn primary" style={{ alignSelf: "flex-start" }}>{busy ? "Adding…" : "＋ Add camera"}</button>
          </div>

          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            🔒 SAM only connects to cameras on your own network — a public address is refused. It records nothing and uploads nothing.
          </div>
        </div>
      </aside>
    </div>
  );
}

const inp: React.CSSProperties = { padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14 };
const chip = (on: boolean): React.CSSProperties => ({ fontSize: 12.5, padding: "5px 11px", borderRadius: 8, border: "1px solid var(--border)", background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent-text)" : "var(--muted)", cursor: "pointer", fontWeight: 600 });
