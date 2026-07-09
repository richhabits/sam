import { contextBridge, ipcRenderer } from "electron";

// Expose safe APIs to the React renderer process
contextBridge.exposeInMainWorld("samDesktop", {
  isNative: true,
  openStudio: () => ipcRenderer.send("open-studio"),
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
