# The Wire — reaching SAM off the Mac, without putting SAM on the internet

**Status: built, OFF by default.** `SAM_MESH` is unset until you turn it on. Nothing
about SAM changes until you do.

## What this is

SAM's API binds to `127.0.0.1` by default — nothing outside the Mac can reach it, ever.
`SAM_REMOTE` (already shipped) widens that to the LAN, for same-Wi-Fi phone access. This
is the next step: reaching SAM from *anywhere* — cellular, a coffee shop, a different
building — **without ever exposing port 8787 to the public internet.**

The mechanism is a private mesh: a WireGuard-class overlay network. Every device you
join to it (the Mac, your phone) gets its own address in a private range
(`100.64.0.0/10`) and can reach every other joined device directly, encrypted
end-to-end, with **zero inbound firewall holes and no port-forwarding** — the opposite
of the classic "open a port on your router" approach, which this project explicitly
never does.

Once the mesh is up, SAM's server binds **only** to its mesh address — not `0.0.0.0`,
not the LAN. A device that hasn't joined your mesh cannot reach SAM at all, full stop,
regardless of what network it's on.

Authorization is unchanged: the mesh is a narrower *transport*, not a looser trust
boundary. Every request still needs the same remote token this project's LAN mode
already requires, and every yard/task action still needs a paired session on top of
that (see `server/http-guards.ts`). Reachable was never the same as authorized here,
and the mesh doesn't change that.

## Setting it up

1. Install a WireGuard-class mesh client on the Mac and sign into an account on it (any
   provider works — the code detects the interface by its address range, not by which
   client created it). Do the same on your phone, using the **same account**, so both
   devices join the same private mesh.
2. Confirm both devices show an address starting `100.` (most clients show this on
   their own status screen).
3. Pick a strong secret (32+ random characters) for `SAM_REMOTE_TOKEN` — the same
   token LAN mode uses. **Do not reuse a token you've shared anywhere else.**
4. Start SAM with:
   ```bash
   SAM_MESH=1 SAM_REMOTE_TOKEN=<your-secret> npm start
   ```
   (or the equivalent in however you normally launch the packaged app — an env var,
   same as `SAM_REMOTE` today).
5. On boot, SAM prints the mesh address to open from your phone:
   ```
   🔒 mesh access  · open http://100.x.y.z:8787/?token=YOUR_TOKEN on any device
      joined to the mesh (works off Wi-Fi, over cellular)
   ```
6. Open that URL once on the phone (over cellular, mesh connected) — the token sets a
   cookie, so you won't need to paste it again. Then pair the browser as normal (the
   Pairing flow from `server/pairing.ts`, unchanged) for the yard/task actions.

## What "fails closed" means here

If `SAM_MESH=1` is set but no mesh interface is actually found (client not installed,
not connected, or not signed in), SAM does **not** fall back to `0.0.0.0` or the LAN —
it logs a warning and binds to loopback only, exactly as if remote access were off
entirely:

```
⚠️ SAM_MESH ignored — no mesh interface found (100.64.0.0/10). Is the mesh client
   installed and connected?
```

A missing mesh must never silently become a *wider* exposure than intended — that's
the one failure mode this project treats as unacceptable.

## The documented alternative: an authenticated tunnel

The brief this was built against also names a second option: an authenticated tunnel
through a CDN provider you already use, terminating at SAM. This creates a real public
endpoint — reachable from anywhere on the internet — whose entire security rests on
the access layer in front of it (the tunnel's own auth, plus everything SAM already
requires on top). That's a materially different risk shape from the mesh (which has
**no public endpoint at all**), which is exactly why the mesh is the one actually
implemented here.

**Not built.** If you want this path instead, the shape would be: run the tunnel
client alongside SAM, point it at `127.0.0.1:8787`, put real authentication on the
tunnel's own edge (never rely on SAM_REMOTE_TOKEN alone as the only gate on a public
endpoint), and keep `SAM_MESH`/`SAM_REMOTE` off. **Off by default** — nothing here
turns it on for you, and nothing in this codebase currently wires it up.

## Troubleshooting

- **"SAM_MESH ignored — no mesh interface found"** — the mesh client isn't installed,
  isn't running, or isn't signed in on this Mac. Check its own status screen.
- **"SAM_MESH ignored — set SAM_REMOTE_TOKEN..."** — the token is missing or under 16
  characters. Use something long and random, not a word.
- **Phone can't reach the mesh URL** — confirm the phone is actually joined to the same
  mesh account (its own status screen should show a `100.x.y.z` address), and that it's
  really using cellular/a different network (same-Wi-Fi already works via `SAM_REMOTE`
  without any of this).
