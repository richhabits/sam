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
    const res = await fetch(`http://${peer.ip}:${peer.port}/p2p/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: NODE_ID, message, project }),
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
  p2p.use(express.json({ limit: "1mb" }));

  // Health/ping — peers use this to verify reachability
  p2p.get("/p2p/ping", (_req, res) => {
    res.json({ id: NODE_ID, name: hostname(), ts: Date.now() });
  });

  // Receive a task from another SAM
  p2p.post("/p2p/task", async (req, res) => {
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
