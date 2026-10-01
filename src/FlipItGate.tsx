import { useEffect, useState } from "react";
import FlipItView from "./FlipItView";
import { getStatus } from "./lib/api";

// FLIP IT is its own app now (docs/decisions/0001-flipit-is-an-add-on.md). The built-in desk only
// renders when the server says SAM_FLIPIT_BUILTIN=1; otherwise this card points at the add-on.
// Wiring only — FlipItView itself is untouched.
export default function FlipItGate() {
  const [builtin, setBuiltin] = useState<boolean | null>(null);
  useEffect(() => {
    // An old server with no flag keeps today's behaviour; an unreachable one shows the card's pointer too.
    getStatus().then((s) => setBuiltin(s?.flipitBuiltin !== false)).catch(() => setBuiltin(false));
  }, []);
  if (builtin === null) return null;
  if (builtin) return <FlipItView />;
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg, #000)", color: "var(--text, #F3F4F6)", fontFamily: "var(--sans, system-ui)", padding: 16 }}>
      <div style={{ maxWidth: 420, background: "#16181D", border: "1px solid #232730", borderRadius: 12, padding: "18px 20px", lineHeight: 1.5 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>FLIP IT is its own app now</div>
        <div style={{ fontSize: 13.5, color: "var(--muted, #9CA3AF)" }}>
          Connect it as an add-on and SAM can read your rig (status, ledger, candidates) without ever trading.
          In SAM, open API keys & providers, then Connected Apps, then Integrations, and choose FLIP IT (add-on).
        </div>
        <button type="button" onClick={() => { location.href = location.pathname; }} style={{ marginTop: 12, background: "transparent", color: "inherit", border: "1px solid #232730", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}>
          Open SAM
        </button>
      </div>
    </div>
  );
}
