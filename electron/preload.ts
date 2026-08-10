import { contextBridge, ipcRenderer } from "electron";

// Expose safe APIs to the React renderer process
contextBridge.exposeInMainWorld("samDesktop", {
  isNative: true,
  openStudio: () => ipcRenderer.send("open-studio"),
  // The per-launch control token (the Handshake). Only the real renderer gets it — a local process
  // can't read this context. The frontend attaches it to /api calls; see src/lib/authFetch.ts.
  controlToken: process.env.SAM_CONTROL_TOKEN || "",
  // A5 — desktop-only "reveal in Finder" for a task's files. relPath is "<slug>/<file path
  // within the project>", re-validated and confined server-side in main.ts — this bridge
  // just carries the string, it enforces nothing itself.
  revealInFinder: (relPath: string) => ipcRenderer.invoke("reveal-in-finder", relPath),
  // Phone access flips the server's LAN bind at listen()-time, so it only takes effect on a
  // fresh process — see server/routes.people.ts. This lets Settings restart SAM FOR you
  // instead of telling you to quit and reopen it yourself.
  relaunch: () => ipcRenderer.send("relaunch-app"),
});

// ── OVERLAY BRIDGE (Phase 4) — the lightweight ⌥Space palette talks to the main
// process over IPC only (never touches the network directly), so the selected text
// and every action stay inside SAM's own trust boundary. ──
contextBridge.exposeInMainWorld("samOverlay", {
  // main → overlay: a fresh summon delivered the current selection (or "").
  onSummon: (cb: (data: { selection: string }) => void) =>
    ipcRenderer.on("overlay:summon", (_e, data) => cb(data)),
  // overlay → main (request/response): run a quick action or freeform ask through the cascade.
  run: (payload: { action: string; selection: string; freeform?: string }) =>
    ipcRenderer.invoke("overlay:run", payload),
  copy: (text: string) => ipcRenderer.invoke("overlay:copy", text),
  pasteBack: (text: string) => ipcRenderer.invoke("overlay:paste", text),
  runAsTask: (task: string) => ipcRenderer.invoke("overlay:run-as-task", task),
  hide: () => ipcRenderer.send("overlay:hide"),
});
