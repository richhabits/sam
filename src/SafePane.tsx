import { useEffect, useState } from "react";
import { getSafeMigratePreview, getSafeStatus, safeLock, safeMigrate, safeSetup, safeUnlock } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// 🔒 The Safe — set up, unlock, and migrate SAM's secrets into an encrypted-at-rest store. Everything
// here is on-device and loopback+Handshake gated; a secret VALUE never crosses the wire — the pane
// only ever sees names, counts, and typed error reasons. The one irreversible action (migrate, which
// strips plaintext from .env) is behind an explicit confirm.

type Status = { setup: boolean; unlocked: boolean; mode: "keychain" | "passphrase" | "keychain+passphrase" | null; count: number | null };
type Preview = { names: string[]; count: number; total: number };

const ERRORS: Record<string, string> = {
  "already-setup": "The Safe is already set up.",
  "weak-passphrase": "The passphrase must be at least 8 characters.",
  "keychain-unavailable": "No OS keychain available — set a passphrase instead.",
  "not-setup": "The Safe isn't set up yet.",
  "missing-passphrase": "This Safe needs a passphrase to unlock.",
  "bad-passphrase": "Wrong passphrase.",
  "locked": "The Safe is locked — unlock it first.",
  "verify-failed": "A secret failed to verify — nothing was changed, your .env is intact.",
};
const say = (e?: string) => (e && ERRORS[e]) || e || "Something went wrong.";

export default function SafePane({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  // setup form
  const [useKeychain, setUseKeychain] = useState(true);
  const [pass, setPass] = useState("");
  // unlock form
  const [unlockPass, setUnlockPass] = useState("");
  // migration
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmMigrate, setConfirmMigrate] = useState(false);

  // Reload BOTH status and the migration preview — the preview must refresh after a migrate (the .env
  // was stripped), so it can't hang off setup/unlocked alone (those don't change on migrate).
  const load = async () => {
    const s = await getSafeStatus().catch(() => null);
    if (!s) { setErr("Couldn't reach the Safe."); return; }
    setSt(s);
    if (s.setup && s.unlocked) setPreview(await getSafeMigratePreview().catch(() => null));
    else setPreview(null);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => { load(); }, []);

  const run = async (fn: () => Promise<any>, ok?: (r: any) => void) => {
    setBusy(true); setErr(""); setNote("");
    try { const r = await fn(); if (r && r.ok === false) setErr(say(r.error)); else ok?.(r); }
    catch { setErr("Couldn't reach the Safe."); }
    finally { setBusy(false); await load(); }
  };

  const doSetup = () => run(() => safeSetup(pass, useKeychain), (r) => { setNote(`Set up (${r.mode}).${r.warning ? ` ${r.warning}` : ""}`); setPass(""); });
  const doUnlock = () => run(() => safeUnlock(unlockPass), () => { setUnlockPass(""); setNote("Unlocked."); });
  const doLock = () => run(() => safeLock(), () => setNote("Locked."));
  const doMigrate = () => run(() => safeMigrate(), (r) => { setConfirmMigrate(false); setNote(`Sealed ${r.migrated.length} secret(s) and removed them from .env.`); });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer safe-pane" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">🔒 The Safe</div>
            <div className="drawer-sub">Your secrets, <b>encrypted at rest on this device</b>. A key value never leaves the Safe — nothing here is sent anywhere.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!st ? <div className="drawer-empty">Loading…</div> : (
          <div className="safe-body">
            {err && <div className="safe-msg safe-err">{err}</div>}
            {note && <div className="safe-msg safe-ok">{note}</div>}

            {/* ── NOT SET UP → set up ── */}
            {!st.setup && (
              <section className="safe-card">
                <h3>Set up the Safe</h3>
                <label className="safe-check"><input type="checkbox" checked={useKeychain} onChange={(e) => setUseKeychain(e.target.checked)} /> Use the OS keychain <span className="safe-hint">seamless — unlocks automatically at launch (recommended)</span></label>
                <label className="safe-field">Passphrase backup <span className="safe-hint">recommended — recovers the Safe if the keychain is ever lost</span>
                  <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={useKeychain ? "optional but recommended" : "required (≥ 8 characters)"} autoComplete="new-password" />
                </label>
                <div className="safe-warn">⚠️ There is <b>no recovery</b> without at least one of: this keychain, or the passphrase. Keychain <b>and</b> passphrase is the safest choice.</div>
                <button type="button" className="safe-btn-primary" disabled={busy || (!useKeychain && pass.length < 8)} onClick={doSetup}>Set up the Safe</button>
              </section>
            )}

            {/* ── SET UP + LOCKED → unlock ── */}
            {st.setup && !st.unlocked && (
              <section className="safe-card">
                <h3>Unlock the Safe</h3>
                <div className="safe-sub">It's set up ({st.mode}) but locked — your secrets are unavailable until you unlock.</div>
                <label className="safe-field">Passphrase
                  <input type="password" value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && unlockPass) doUnlock(); }} autoComplete="current-password" />
                </label>
                <button type="button" className="safe-btn-primary" disabled={busy || !unlockPass} onClick={doUnlock}>Unlock</button>
              </section>
            )}

            {/* ── SET UP + UNLOCKED → status + migrate + lock ── */}
            {st.setup && st.unlocked && (
              <>
                <section className="safe-card">
                  <div className="safe-status"><span className="safe-dot" /> Unlocked · <b>{st.mode}</b> · {st.count ?? 0} secret{st.count === 1 ? "" : "s"} sealed</div>
                  <button type="button" className="safe-btn" disabled={busy} onClick={doLock}>Lock the Safe</button>
                </section>

                <section className="safe-card">
                  <h3>Move secrets into the Safe</h3>
                  {preview && preview.count > 0 ? (
                    <>
                      <div className="safe-sub"><b>{preview.count}</b> plaintext secret{preview.count === 1 ? "" : "s"} found in your <code>.env</code> (of {preview.total} known names):</div>
                      <div className="safe-names">{preview.names.map((n) => <span key={n} className="safe-name">{n}</span>)}</div>
                      {!confirmMigrate ? (
                        <button type="button" className="safe-btn-primary" disabled={busy} onClick={() => setConfirmMigrate(true)}>Seal {preview.count} secret{preview.count === 1 ? "" : "s"} & remove from .env…</button>
                      ) : (
                        <div className="safe-confirm">
                          <div className="safe-warn">⚠️ This <b>rewrites your .env</b> — each secret is sealed and verified, then its plaintext line is removed. Irreversible. (Every secret is checked first; if any fails, nothing changes.)</div>
                          <div className="safe-row">
                            <button type="button" className="safe-btn-danger" disabled={busy} onClick={doMigrate}>Yes, seal & strip .env</button>
                            <button type="button" className="safe-btn" disabled={busy} onClick={() => setConfirmMigrate(false)}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="safe-sub">No plaintext secrets left in <code>.env</code> — everything is sealed. ✅</div>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
