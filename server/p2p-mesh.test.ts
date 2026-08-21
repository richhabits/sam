import { describe, it, expect } from "vitest";
import {
  registerPeerNode,
  listActivePeers,
  createGossipMessage,
  processIncomingMeshGossip,
  getMeshTopologyReport,
  computeGossipSignature,
} from "./p2p-mesh.ts";

describe("S.A.M. P2P LAN Mesh & Vector State Gossip Engine", () => {
  it("registers peer nodes and lists active peers", () => {
    const nodeA = registerPeerNode({
      nodeId: "mac-mini-m4",
      deviceName: "Romeo HQ Mac Mini",
      platform: "darwin",
      address: "192.168.1.105",
      port: 3000,
      capabilities: ["vault_sync", "yard_manifest", "agent_task"],
    });

    expect(nodeA.status).toBe("ONLINE");
    expect(nodeA.deviceName).toBe("Romeo HQ Mac Mini");

    const peers = listActivePeers();
    expect(peers.some((p) => p.nodeId === "mac-mini-m4")).toBe(true);
  });

  it("creates cryptographically signed gossip messages with vector clocks", () => {
    const msg = createGossipMessage("vault_sync", { docId: "architecture.md", version: 4 }, { "node-alpha": 2 });

    expect(msg.channel).toBe("vault_sync");
    expect(msg.signature).toBeTruthy();
    expect(msg.vectorClock[msg.originNodeId]).toBe(1);
    expect(msg.vectorClock["node-alpha"]).toBe(2);
  });

  it("processes gossip messages with deduplication and signature verification", () => {
    const payload = { event: "yard_app_deployed", port: 4250 };
    const origin = "test-node-x";
    const ts = Date.now();
    const sig = computeGossipSignature(origin, "yard_manifest", ts, payload);

    const validMsg = {
      messageId: "msg-valid-100",
      originNodeId: origin,
      channel: "yard_manifest" as const,
      payload,
      vectorClock: { [origin]: 1 },
      hopsRemaining: 2,
      timestamp: ts,
      signature: sig,
    };

    // First receive: accepted and forwards
    const res1 = processIncomingMeshGossip(validMsg);
    expect(res1.accepted).toBe(true);
    expect(res1.forward).toBe(true);

    // Replay receive: rejected as duplicate
    const resDuplicate = processIncomingMeshGossip(validMsg);
    expect(resDuplicate.accepted).toBe(false);
    expect(resDuplicate.reason).toContain("Duplicate");

    // Corrupted signature: rejected
    const tamperedMsg = {
      ...validMsg,
      messageId: "msg-tampered-101",
      signature: "invalid-signature",
    };
    const resTampered = processIncomingMeshGossip(tamperedMsg);
    expect(resTampered.accepted).toBe(false);
    expect(resTampered.reason).toContain("Invalid cryptographic signature");
  });

  it("reports live mesh topology summary", () => {
    const topology = getMeshTopologyReport();
    expect(topology.localNodeId).toMatch(/^sam-node-/);
    expect(topology.peerNodes.length).toBeGreaterThanOrEqual(1);
    expect(topology.recentChannels).toContain("vault_sync");
  });
});
