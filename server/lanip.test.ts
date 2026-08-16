import { describe, it, expect } from "vitest";
import type os from "node:os";
import { lanIP } from "./routes.people.ts";

// lanIP() answers one question: "what address do I put in a QR code so a phone on the Wi-Fi
// lands on THIS Mac?" The first cut answered a different one — "what is the first interface the
// OS lists that isn't loopback?" — and on a Mac with an idle Ethernet port that is 169.254.x.x,
// a self-assigned address that looks like a LAN IP and routes nowhere. Every case below is a
// machine shape where those two questions have different answers.

const ip = (address: string): os.NetworkInterfaceInfo =>
  ({ address, family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null }) as os.NetworkInterfaceInfo;
const loopback = (): os.NetworkInterfaceInfo =>
  ({ ...ip("127.0.0.1"), internal: true }) as os.NetworkInterfaceInfo;
const v6 = (address: string): os.NetworkInterfaceInfo =>
  ({ ...ip(address), family: "IPv6" }) as os.NetworkInterfaceInfo;

describe("lanIP — the address a phone can actually reach", () => {
  it("skips a self-assigned 169.254 address for the real Wi-Fi one", () => {
    // The reported bug, exactly: an idle Ethernet port listed before Wi-Fi.
    expect(lanIP({ lo0: [loopback()], en5: [ip("169.254.71.12")], en0: [ip("172.20.10.3")] })).toBe("172.20.10.3");
  });

  it("returns null rather than a self-assigned address when that is all there is", () => {
    // Nothing to hand out. Saying so is the point — a 169.254 in a QR is a code burned on a
    // link that cannot connect, which reads to the user as "pairing is broken".
    expect(lanIP({ lo0: [loopback()], en5: [ip("169.254.71.12")] })).toBeNull();
  });

  it("returns null on a machine with nothing but loopback", () => {
    expect(lanIP({ lo0: [loopback()] })).toBeNull();
  });

  it("prefers the physical NIC over a VPN tunnel", () => {
    // utun is listed first while the VPN is up; the phone is on the Wi-Fi, not in the tunnel.
    expect(lanIP({ utun3: [ip("10.8.0.6")], en0: [ip("192.168.1.24")] })).toBe("192.168.1.24");
  });

  it("prefers the physical NIC over Docker / VM host-only networks", () => {
    expect(lanIP({ vmnet8: [ip("192.168.64.1")], docker0: [ip("172.17.0.1")], en0: [ip("10.0.0.9")] })).toBe("10.0.0.9");
  });

  it("prefers a physical NIC's public address over a tunnel's private one", () => {
    // Physical-vs-virtual dominates: being on the same wire beats looking like a LAN range.
    expect(lanIP({ utun0: [ip("10.2.0.5")], en0: [ip("81.2.44.9")] })).toBe("81.2.44.9");
  });

  it("keeps Internet Sharing (bridge100) — the phone really is on the other end", () => {
    expect(lanIP({ bridge100: [ip("192.168.2.1")] })).toBe("192.168.2.1");
  });

  it("falls back to a tunnel address when it is the only thing left", () => {
    // Not great, but it is a real address on a real network, unlike 169.254.
    expect(lanIP({ lo0: [loopback()], utun4: [ip("100.72.3.8")] })).toBe("100.72.3.8");
  });

  it("ignores IPv6 addresses", () => {
    // The pairing URL is built as http://<ip>:<port> — a bare IPv6 literal there is malformed.
    expect(lanIP({ en0: [v6("fe80::1"), ip("192.168.1.7")] })).toBe("192.168.1.7");
    expect(lanIP({ en0: [v6("2001:db8::1")] })).toBeNull();
  });

  it("keeps the OS's own order between equally good interfaces", () => {
    // en0 is Wi-Fi on a Mac and listed first; nothing here should reshuffle that.
    expect(lanIP({ en0: [ip("192.168.1.10")], en1: [ip("192.168.1.11")] })).toBe("192.168.1.10");
  });

  it("reads the live machine when given no argument", () => {
    const live = lanIP();
    expect(live === null || /^\d+\.\d+\.\d+\.\d+$/.test(live)).toBe(true);
    if (typeof live === "string") expect(live).not.toMatch(/^169\.254\./);
  });
});
