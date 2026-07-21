import { useEffect, useState } from "react";
import { requestYardPairing, collectYardPairing, setPairToken, pairStatus } from "./lib/api";

// 🔑 PAIRING — the way a browser tab gets back in.
//
// SAM requires a per-launch passkey on privileged routes. The desktop app receives it
// through preload; a browser tab has no way to read it, so it pairs instead — the app
// approves, once, against a code you can see on both screens.
//
// This component exists because the first version of that shipped with the lock on and
// the key hidden: the only way to start pairing was to press Kill on a running build job
// and have it fail. Everything else — the money desk, cameras, the standing crew — simply
// returned 403 with no route out. A prompt has to appear wherever the refusal appears,
// which means it has to live in ONE place that every panel can use.

export function useNeedsPairing(): boolean | null {
  const [needed, setNeeded] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    pairStatus()
      .then((s: any) => { if (alive) setNeeded(!!s?.needed); })
      .catch(() => { if (alive) setNeeded(false); });   // can't ask ⇒ don't nag
    return () => { alive = false; };
  }, []);
  return needed;
}

type Tone = "banner" | "card";

export default function PairPrompt({ tone = "card", onPaired }: { tone?: Tone; onPaired?: () => void }) {
  const [req, setReq] = useState<{ id: string; code: string } | null>(null);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  // Wait for the app to approve. Polls only this browser's OWN request id, so it never
  // learns anything about anyone else's.
  useEffect(() => {
    if (!req) return;
    const iv = setInterval(() => {
      collectYardPairing(req.id).then((r: any) => {
        if (!r?.token) return;
        setPairToken(r.token);
        setDone(true);
        setReq(null);
        onPaired?.();
        // A reload is the honest way to apply it: every panel re-reads with the token
        // attached, rather than half the screen being paired and half not.
        setTimeout(() => location.reload(), 900);
      }).catch(() => {/* still waiting */});
    }, 1500);
    const giveUp = setTimeout(() => { setReq(null); setErr("That request expired — start it again."); }, 5 * 60_000);
    return () => { clearInterval(iv); clearTimeout(giveUp); };
  }, [req, onPaired]);

  const start = () => {
    setErr("");
    const label = navigator.userAgent.includes("Chrome") ? "Chrome on this Mac"
      : navigator.userAgent.includes("Safari") ? "Safari on this Mac" : "This browser";
    requestYardPairing(label)
      .then((r: any) => (r?.id ? setReq(r) : setErr("Couldn't start pairing.")))
      .catch(() => setErr("Couldn't reach SAM to start pairing."));
  };

  const banner = tone === "banner";
  const box: React.CSSProperties = banner
    ? { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        padding: "10px 14px", borderRadius: 12, background: "rgba(240,130,78,.10)", border: "1px solid rgba(240,130,78,.45)" }
    : { padding: 18, borderRadius: 14, background: "rgba(240,130,78,.08)", border: "1px solid rgba(240,130,78,.4)", textAlign: "center" };

  if (done) {
    return <div style={box}><span style={{ fontSize: 13, fontWeight: 600 }}>Paired — reloading…</span></div>;
  }

  if (req) {
    return (
      <div style={{ ...box, textAlign: "center", display: "block" }}>
        <div style={{ fontSize: 12.5, opacity: .85, marginBottom: 6 }}>
          Open the SAM app → Control Centre → Automations, and approve this number:
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: ".24em", fontVariantNumeric: "tabular-nums" }}>{req.code}</div>
        <div style={{ fontSize: 11.5, opacity: .6, marginTop: 6 }}>waiting for the app to approve — expires in five minutes</div>
      </div>
    );
  }

  return (
    <div style={box}>
      <span style={{ fontSize: 13, lineHeight: 1.5 }}>
        <b>This browser isn't paired with SAM.</b>{" "}
        Some panels — the money desk, cameras, the yard — will stay empty until it is.
        {err && <span style={{ color: "#EF4444" }}> {err}</span>}
      </span>
      <button type="button" onClick={start}
        style={{ marginTop: banner ? 0 : 12, background: "#F0824E", color: "#1a1207", border: "none",
                 borderRadius: 9, padding: "8px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
        Pair this browser
      </button>
    </div>
  );
}
