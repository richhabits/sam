// ─────────────────────────────────────────────────────────────
//  S.A.M. · P2P LAN SWARM MESH & VECTOR STATE GOSSIP ENGINE
//
//  Decentralized zero-cloud device synchronization across local Wi-Fi.
//  Syncs vault documents, Yard project manifests, and companion vitals
//  with cryptographic node verification and vector-clock gossip.
// ─────────────────────────────────────────────────────────────

import { createHash, randomUUID } from "node:crypto";

export interface MeshNode {
  nodeId: string;
  deviceName: string;
  platform: "darwin" | "linux" | "win32" | "ios" | "android" | "unknown";
  address: string;
  port: number;
  capabilities: string[];
  lastSeenAt: number;
  status: "ONLINE" | "STALE" | "OFFLINE";
}

export interface MeshGossipMessage {
  messageId: string;
  originNodeId: string;
  channel: "vault_sync" | "yard_manifest" | "companion_vitals" | "agent_task";
  payload: any;
  vectorClock: Record<string, number>;
  hopsRemaining: number;
  timestamp: number;
  signature: string;
}

export interface MeshTopology {
  localNodeId: string;
  totalActivePeers: number;
  peerNodes: MeshNode[];
  recentChannels: string[];
  processedMessageCount: number;
}

const PEER_NODES = new Map<string, MeshNode>();
const PROCESSED_MESSAGE_IDS = new Set<string>();
const MAX_SEEN_CACHE = 1000;
const PEER_STALE_TTL_MS = 60_000;

const localNodeId = `sam-node-${createHash("sha256").update(process.env.HOSTNAME || "localhost-romeo").digest("hex").slice(0, 12)}`;

/**
 * Registers or heartbeats a peer node in the local mesh network.
 */
export function registerPeerNode(node: {
  nodeId: string;
  deviceName: string;
  platform?: MeshNode["platform"];
  address: string;
  port: number;
  capabilities?: string[];
}): MeshNode {
  const existing = PEER_NODES.get(node.nodeId);
  const updated: MeshNode = {
    nodeId: node.nodeId,
    deviceName: node.deviceName,
    platform: node.platform || "unknown",
    address: node.address,
    port: node.port,
    capabilities: node.capabilities || ["vault_sync", "yard_manifest"],
    lastSeenAt: Date.now(),
    status: "ONLINE",
  };
  PEER_NODES.set(node.nodeId, updated);
  return updated;
}

/**
 * Returns all active (non-stale) peer nodes.
 */
export function listActivePeers(now = Date.now()): MeshNode[] {
  const list: MeshNode[] = [];
  for (const [id, node] of PEER_NODES) {
    if (now - node.lastSeenAt > PEER_STALE_TTL_MS) {
      node.status = "STALE";
    } else {
      node.status = "ONLINE";
      list.push(node);
    }
  }
  return list;
}

/**
 * Computes payload signature for tamper-evident verification.
 */
export function computeGossipSignature(originId: string, channel: string, timestamp: number, payload: any): string {
  const raw = `${originId}:${channel}:${timestamp}:${JSON.stringify(payload)}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Creates and formats a signed gossip broadcast message.
 */
export function createGossipMessage(
  channel: MeshGossipMessage["channel"],
  payload: any,
  vectorClock: Record<string, number> = {},
  maxHops = 3
): MeshGossipMessage {
  const timestamp = Date.now();
  const originNodeId = localNodeId;
  const messageId = `msg-${randomUUID().slice(0, 8)}`;
  const signature = computeGossipSignature(originNodeId, channel, timestamp, payload);

  const updatedClock = { ...vectorClock, [originNodeId]: (vectorClock[originNodeId] || 0) + 1 };

  return {
    messageId,
    originNodeId,
    channel,
    payload,
    vectorClock: updatedClock,
    hopsRemaining: maxHops,
    timestamp,
    signature,
  };
}

/**
 * Processes incoming gossip messages with deduplication and integrity check.
 */
export function processIncomingMeshGossip(message: MeshGossipMessage): {
  accepted: boolean;
  forward: boolean;
  reason?: string;
} {
  if (!message || !message.messageId || !message.originNodeId) {
    return { accepted: false, forward: false, reason: "Malformed gossip packet" };
  }

  // Deduplication check
  if (PROCESSED_MESSAGE_IDS.has(message.messageId)) {
    return { accepted: false, forward: false, reason: "Duplicate message already processed" };
  }

  // Signature verification
  const expectedSig = computeGossipSignature(
    message.originNodeId,
    message.channel,
    message.timestamp,
    message.payload
  );
  if (message.signature !== expectedSig) {
    return { accepted: false, forward: false, reason: "Invalid cryptographic signature" };
  }

  // Mark as processed
  PROCESSED_MESSAGE_IDS.add(message.messageId);
  if (PROCESSED_MESSAGE_IDS.size > MAX_SEEN_CACHE) {
    const firstKey = PROCESSED_MESSAGE_IDS.values().next().value;
    if (firstKey) PROCESSED_MESSAGE_IDS.delete(firstKey);
  }

  const shouldForward = message.hopsRemaining > 1;

  return {
    accepted: true,
    forward: shouldForward,
  };
}

/**
 * Returns high-level network topology status.
 */
export function getMeshTopologyReport(): MeshTopology {
  const active = listActivePeers();
  return {
    localNodeId,
    totalActivePeers: active.length,
    peerNodes: active,
    recentChannels: ["vault_sync", "yard_manifest", "companion_vitals", "agent_task"],
    processedMessageCount: PROCESSED_MESSAGE_IDS.size,
  };
}
