// ─────────────────────────────────────────────────────────────
//  S.A.M. · PEER-TO-PEER SWARM
//  Discovers other SAM instances on the local network via mDNS
//  (Bonjour/Zeroconf) and exposes a lightweight P2P API so
//  multiple SAMs can farm tasks to each other.
//
//  Security: The P2P listener runs on a SEPARATE port (8788)
//  bound to 0.0.0.0 so LAN peers can reach it. The main API
//  stays locked to 127.0.0.1 — nothing changes there.
// ─────────────────────────────────────────────────────────────

import { Bonjour } from "bonjour-service";
import express from "express";
import { hostname } from "node:os";
import { timingSafeEqual, createHmac, createHash, randomBytes } from "node:crypto";

// ── AUTHENTICATION (audit fix — finding 11) ──────────────────
// The old scheme sent the shared SAM_P2P_TOKEN as a bearer header to whatever peer we
// dispatched to. But peers are discovered over mDNS, which is UNAUTHENTICATED: a LAN attacker
// advertises a fake `sam-p2p` service, we dispatch to it, and it harvests the token straight
// out of our request header — then replays it to drive OUR agent loop. Discovery is not trust.
//
// Now the token is an HMAC KEY that is NEVER transmitted. Each request carries a fresh
// timestamp + nonce and an HMAC signature bound to (method, path, ts, nonce, body-hash). A peer
// proves it knows the secret by producing a valid signature; a fake peer that receives a
// dispatch sees only a one-time signature it cannot reverse into the key. Signatures are
// time-boxed and single-use (nonce), so a captured one cannot be replayed.
const P2P_SIG_WINDOW_MS = 60_000;

function p2pSign(key: string, method: string, path: string, ts: string, nonce: string, body: string): string {
  const bodyHash = createHash("sha256").update(body || "").digest("hex");
  return createHmac("sha256", key).update([method.toUpperCase(), path, ts, nonce, bodyHash].join("\n")).digest("hex");
}

/** Headers that prove knowledge of `key` for THIS request, without sending the key. */
export function p2pAuthHeaders(
  key: string, method: string, path: string, body: string,
  gen: { now?: number; nonce?: string } = {},
): Record<string, string> {
  const ts = String(gen.now ?? Date.now());
  const nonce = gen.nonce ?? randomBytes(12).toString("hex");
  return { "x-sam-p2p-ts": ts, "x-sam-p2p-nonce": nonce, "x-sam-p2p-sig": p2pSign(key, method, path, ts, nonce, body) };
}

/** Verify a signed request: correct HMAC (constant-time), fresh (within the window). Pure —
 *  the nonce replay-check is layered on top by the caller (see freshNonce). */
export function p2pVerify(
  key: string, method: string, path: string, body: string,
  headers: { ts?: string; nonce?: string; sig?: string },
  opts: { now?: number; windowMs?: number } = {},
): { ok: boolean; reason?: string } {
  if (!key || key.length < 16) return { ok: false, reason: "no shared secret configured" };
  const { ts, nonce, sig } = headers;
  if (!ts || !nonce || !sig) return { ok: false, reason: "missing signature" };
  const now = opts.now ?? Date.now();
  const window = opts.windowMs ?? P2P_SIG_WINDOW_MS;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(now - t) > window) return { ok: false, reason: "stale or future signature" };
  const expect = p2pSign(key, method, path, ts, nonce, body);
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}

// Single-use nonce store: a valid signature can only be accepted once inside its time window,
// so even a captured-and-replayed signature is refused the second time. Bounded by pruning
// anything past the window. Injectable store + clock keep it unit-testable.
export function freshNonce(store: Map<string, number>, nonce: string, now: number, windowMs = P2P_SIG_WINDOW_MS): boolean {
  for (const [n, exp] of store) if (exp <= now) store.delete(n);
  if (store.has(nonce)) return false;
  store.set(nonce, now + windowMs);
  return true;
}
const seenNonces = new Map<string, number>();

export interface Peer {
  id: string;
  ip: string;
  port: number;
  name: string;
  lastSeen: number;
}

const activePeers = new Map<string, Peer>();
let bonjour: Bonjour | null = null;
const NODE_ID = `sam-${hostname()}-${Math.floor(Math.random() * 10000)}`;
const P2P_PORT = Number(process.env.P2P_PORT || 8788);

// P2P is OFF by default: it binds to the LAN and lets peers drive this SAM's
// agent loop, so it must be explicitly opted into AND authenticated. Enable with
// SAM_P2P=1 and share SAM_P2P_TOKEN with the machines you trust. Without a token,
// incoming tasks are refused (discovery/ping still work).
export const P2P_ENABLED = /^(1|true|on|yes)$/i.test(process.env.SAM_P2P || "");
const P2P_TOKEN = process.env.SAM_P2P_TOKEN || "";

// ── Discovery ────────────────────────────────────────────────

export function startP2PDiscovery() {
  if (bonjour) return;
  bonjour = new Bonjour();

  // Advertise this SAM instance on the LAN
  bonjour.publish({
    name: NODE_ID,
    type: "sam-p2p",
    port: P2P_PORT,
    txt: { id: NODE_ID, v: "1" },
  });

  // Browse for other SAM instances
  const browser = bonjour.find({ type: "sam-p2p" });

  browser.on("up", (service: any) => {
    const ip = service.referer?.address || service.host;
    const peerId = service.txt?.id || service.name || ip;
    if (!ip || peerId === NODE_ID) return; // don't add ourselves
    activePeers.set(peerId, {
      id: peerId,
      ip,
      port: service.port,
      name: service.name || peerId,
      lastSeen: Date.now(),
    });
    console.log(`  🌐 peer joined  · ${peerId} @ ${ip}:${service.port}`);
  });

  browser.on("down", (service: any) => {
    const peerId = service.txt?.id || service.name || service.referer?.address;
    if (peerId && activePeers.has(peerId)) {
      console.log(`  🌐 peer left    · ${peerId}`);
      activePeers.delete(peerId);
    }
  });
}

// ── Peer Registry ────────────────────────────────────────────

export function getActivePeers(): Peer[] {
  // Prune stale peers (unseen for >5 min)
  const now = Date.now();
  for (const [id, peer] of activePeers.entries()) {
    if (now - peer.lastSeen > 300_000) activePeers.delete(id);
  }
  return Array.from(activePeers.values());
}

export function getNodeId(): string {
  return NODE_ID;
}

// ── Dispatch (send a task to a remote SAM) ───────────────────

export async function dispatchToPeer(
  peer: Peer,
  message: string,
  project?: string,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    // Sign the request instead of shipping the secret. The body is serialized ONCE and both
    // signed and sent, so the receiver's body-hash matches to the byte.
    const body = JSON.stringify({ from: NODE_ID, message, project });
    const res = await fetch(`http://${peer.ip}:${peer.port}/p2p/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...p2pAuthHeaders(P2P_TOKEN, "POST", "/p2p/task", body) },
      body,
      signal: AbortSignal.timeout(120_000), // 2 min max
    });
    if (!res.ok) return { ok: false, error: `peer returned ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { ok: false, error: e?.message || "unreachable" };
  }
}

// Broadcast a task to ALL peers and collect results
export async function broadcastToSwarm(
  message: string,
  project?: string,
): Promise<{ peerId: string; result: any }[]> {
  const peers = getActivePeers();
  if (!peers.length) return [];
  const results = await Promise.allSettled(
    peers.map(async (p) => ({
      peerId: p.id,
      result: await dispatchToPeer(p, message, project),
    })),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map((r) => r.value);
}

// ── P2P Listener (separate from main API) ────────────────────
// This creates a lightweight HTTP server on 0.0.0.0:P2P_PORT
// that ONLY handles P2P traffic. The main API on 127.0.0.1:8787
// is completely untouched.

export function startP2PServer(
  handleTask: (message: string, from: string, project?: string) => Promise<string>,
) {
  const p2p = express();
  // Keep the EXACT received bytes so the signature's body-hash is verified against what was
  // actually sent, not a re-serialization that could differ in key order or spacing.
  p2p.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { (req as any).rawBody = buf.toString("utf8"); } }));

  // Health/ping — peers use this to verify reachability
  p2p.get("/p2p/ping", (_req, res) => {
    res.json({ id: NODE_ID, name: hostname(), ts: Date.now() });
  });

  // Receive a task from another SAM — signature-gated: this runs our agent loop, so an
  // unauthenticated (or replaying) LAN caller must never reach it.
  p2p.post("/p2p/task", async (req, res) => {
    const raw = (req as any).rawBody ?? "";
    const v = p2pVerify(P2P_TOKEN, "POST", "/p2p/task", raw, {
      ts: req.get("x-sam-p2p-ts"), nonce: req.get("x-sam-p2p-nonce"), sig: req.get("x-sam-p2p-sig"),
    });
    if (!v.ok || !freshNonce(seenNonces, String(req.get("x-sam-p2p-nonce")), Date.now())) {
      return res.status(403).json({ ok: false, error: "unauthorized peer" });
    }
    const { from, message, project } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ ok: false, error: "empty" });
    console.log(`  📨 P2P task from ${from || "unknown"}: ${message.slice(0, 80)}…`);
    try {
      const text = await handleTask(message, from || "peer", project);
      res.json({ ok: true, text, from: NODE_ID });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "failed" });
    }
  });

  // Who else is on the network?
  p2p.get("/p2p/peers", (_req, res) => {
    res.json({ self: NODE_ID, peers: getActivePeers() });
  });

  p2p.listen(P2P_PORT, "0.0.0.0", () => {
    console.log(`  🌐 P2P swarm    · http://0.0.0.0:${P2P_PORT}  (LAN-accessible)`);
  });
}
