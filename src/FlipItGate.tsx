import { type CSSProperties, useEffect, useState } from "react";
import FlipItView from "./FlipItView";
import { getStatus } from "./lib/api";

// FLIP IT is its own app (docs/decisions/0001-flipit-is-an-add-on.md). The built-in desk
// only renders when the server says SAM_FLIPIT_BUILTIN=1. Anything else — missing flag,
// old server, unreachable — is the add-on card, not a fake £10k terminal.

export default function FlipItGate() {
  const [builtin, setBuiltin] = useState<boolean | null>(null);
  useEffect(() => {
    getStatus()
      .then((s) => setBuiltin(s?.flipitBuiltin === true))
      .catch(() => setBuiltin(false));
  }, []);

  const backToChat = () => { location.href = location.pathname; };
  const connectAddon = () => { location.href = `${location.pathname}?open=connectors`; };

  if (builtin === null) {
    return (
      <div style={shell}>
        <div style={{ color: "var(--muted, #9CA3AF)", fontSize: 14 }}>Looking for FLIP IT…</div>
      </div>
    );
  }
  if (builtin) return <FlipItView />;
  return (
    <div style={shell}>
      <div style={{ maxWidth: 440, background: "#16181D", border: "1px solid #232730", borderRadius: 14, padding: "22px 24px", lineHeight: 1.5 }}>
        <div style={{ fontSize: 16, fontWeight: 750, marginBottom: 8 }}>FLIP IT is an add-on</div>
        <div style={{ fontSize: 13.5, color: "var(--muted, #9CA3AF)", marginBottom: 16 }}>
          SAM does not trade. Connect FLIP IT as a read-only add-on and it can show your rig — status, ledger, candidates — without placing an order.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={connectAddon} style={primary}>
            Connect add-on
          </button>
          <button type="button" onClick={backToChat} style={ghost}>
            Back to chat
          </button>
        </div>
      </div>
    </div>
  );
}

const shell: CSSProperties = {
  minHeight: "100vh", display: "grid", placeItems: "center",
  background: "var(--bg, #000)", color: "var(--text, #F3F4F6)",
  fontFamily: "var(--sans, system-ui)", padding: 16,
};
const primary: CSSProperties = {
  background: "var(--accent, #7C9EFF)", color: "#0E0F12", border: "none",
  borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer",
};
const ghost: CSSProperties = {
  background: "transparent", color: "inherit", border: "1px solid #232730",
  borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
