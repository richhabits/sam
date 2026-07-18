import { useEffect, useState } from "react";
import { checkUpdate, runUpdate } from "./lib/api";

type Status = { behind: boolean; current?: string; latest?: string; url?: string };

/**
 * The update control: always present, quiet when there's nothing to do, and it pulses when
 * there is.
 *
 * The previous behaviour was a full-width bar that appeared ONLY when already behind — so when
 * you were up to date there was nothing on screen at all, no way to check on demand, and no way
 * to tell "up to date" apart from "the check never ran". A control you can't see is a control
 * you can't trust.
 */
export default function UpdateButton() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState("");

  const look = async (manual = false) => {
    if (manual) setChecking(true);
    try {
      const u = await checkUpdate();
      setStatus(u);
      if (manual) setOpen(true);
    } catch {
      // Network hiccup: keep the last known status rather than blanking the control. The next
      // poll retries; a failed background check is not worth interrupting anyone for.
    } finally {
      setChecking(false);
    }
  };

  // Mount-once poll. Adding `look` to the deps would re-run this on every render and restart
  // the interval each time — the opposite of what a 30-minute poll wants.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-once interval
  useEffect(() => {
    look();
    const iv = setInterval(look, 1000 * 60 * 30); // half-hourly; the check is a cheap HEAD-vs-origin
    return () => clearInterval(iv);
  }, []);

  const behind = !!status?.behind;

  return (
    <div className="upd-wrap">
      <button
        type="button"
        className={`icon-btn upd-btn${behind ? " behind" : ""}${checking ? " spin" : ""}`}
        onClick={() => (behind ? setOpen((v) => !v) : look(true))}
        title={behind ? `SAM ${status?.latest ?? ""} is available` : "Check for updates"}
        aria-label={behind ? "Update available" : "Check for updates"}
      >
        <span className="upd-glyph">⟳</span>
        {behind && <span className="upd-dot" aria-hidden="true" />}
      </button>

      {open && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: scrim; Esc/click-out closes */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: scrim; Esc/click-out closes */}
          <div className="upd-scrim" onClick={() => setOpen(false)} />
          <div className="upd-pop" role="dialog" aria-label="Software update">
            {done ? (
              <>
                <div className="upd-title">Updated</div>
                <div className="upd-sub">Reload to finish.</div>
                <button type="button" className="upd-go" onClick={() => location.reload()}>
                  Reload SAM
                </button>
              </>
            ) : failed ? (
              <>
                <div className="upd-title">Update didn't complete</div>
                <div className="upd-sub">{failed}</div>
              </>
            ) : behind ? (
              <>
                <div className="upd-title">SAM {status?.latest} is available</div>
                <div className="upd-sub">
                  {status?.current ? `You're on ${status.current}.` : "A newer version is ready."}
                </div>
                {status?.url ? (
                  <a className="upd-go" href={status.url} target="_blank" rel="noreferrer">
                    Get the update
                  </a>
                ) : (
                  <button
                    type="button"
                    className="upd-go"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await runUpdate();
                        // Report what actually happened. An update that silently fails and leaves
                        // the button looking fine is worse than one that says it couldn't.
                        if (r?.ok) setDone(true);
                        // An update that fails silently while the button still looks fine is
                        // worse than one that admits it. Surface the reason in place.
                        else setFailed(r?.error || "couldn't update — try the download page");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? "Updating…" : "Update now"}
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="upd-title">You're up to date</div>
                <div className="upd-sub">{status?.current ? `SAM ${status.current}` : "SAM"}</div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
