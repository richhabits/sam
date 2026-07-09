// MUST be first: sets CJS globals, crash visibility, and the writable data dir BEFORE the server
// module below evaluates. (ES imports evaluate in source order, so preboot runs before the server.)
import "./preboot.ts";

import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, dialog, shell, screen, clipboard } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { captureSelection, ensureAccessibility, pasteBack, buildPrompt, overlayHTML, OverlayAction } from "./overlay.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;

// Start the Express backend in this process (boots + listens on 8787). STATIC import so the electron
// build's `external` (better-sqlite3) applies and the native module loads from node_modules rather
// than being bundled and losing its .node. preboot.ts (imported first, above) has already set the
// data dir + CJS globals it needs.
import "../server/index.ts";

// Tell the embedded server which packaged version it is, so /api/update-check can compare against
// the latest GitHub RELEASE (not git) and show an in-app "update available" banner on packaged builds.
try { process.env.SAM_APP_VERSION = app.getVersion(); } catch { /* dev */ }

let win: BrowserWindow | null = null;
let overlay: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ── Update check ──────────────────────────────────────────────
// True silent auto-update needs an Apple signing cert. Without one, we do the honest
// next-best thing: on launch, check GitHub for a newer release and, if there is one,
// offer a one-click download. Never nags — only appears when a newer version exists.
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y; }
  return false;
}
async function checkForUpdates() {
  try {
    const res = await fetch("https://api.github.com/repos/richhabits/sam/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "SAM-app" },
    });
    if (!res.ok) return;
    const rel = await res.json() as { tag_name?: string; html_url?: string };
    const latest = (rel.tag_name || "").replace(/^v/, "");
    if (!latest || !isNewer(latest, app.getVersion())) return;
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "Update available",
      message: `SAM ${latest} is out`,
      detail: `You have ${app.getVersion()}. Download the new version — takes a few seconds, and your data stays put.`,
      buttons: ["Download", "Later"],
      defaultId: 0, cancelId: 1,
    });
    if (response === 0) shell.openExternal(rel.html_url || "https://github.com/richhabits/sam/releases/latest");
  } catch { /* offline — no drama */ }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    backgroundColor: '#00000000', // transparent to let vibrancy show
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // In production, load the built index.html from dist
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Hide instead of close to stay alive in background
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

let brainStatus = "starting…";
function refreshTrayMenu() {
  if (!tray) return;
  const loginOn = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: `● ${brainStatus}`, enabled: false },
    { type: 'separator' },
    { label: 'Open SAM', click: () => { win?.show(); win?.focus(); } },
    { label: 'Summon overlay  ⌥Space', click: () => summonOverlay() },
    { type: 'separator' },
    { label: 'Launch at login', type: 'checkbox', checked: loginOn,
      click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked }); refreshTrayMenu(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}
function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('SAM');
  refreshTrayMenu();
  tray.on('click', () => { win?.show(); win?.focus(); });
  // Poll the embedded server's brain status for the tray badge (best-effort, local only).
  const poll = async () => {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`);
      brainStatus = r.ok ? "SAM online" : "reconnecting…";
    } catch { brainStatus = "starting…"; }
    refreshTrayMenu();
  };
  void poll();
  setInterval(poll, 15000);
}

// ── THE OVERLAY (Phase 4) — a small always-on-top palette summoned by ⌥Space. ──
function createOverlay() {
  overlay = new BrowserWindow({
    width: 620, height: 320,
    show: false, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, movable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      nodeIntegration: false, contextIsolation: true,
    },
  });
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(overlayHTML()));
  overlay.on("blur", () => { if (overlay?.isVisible()) overlay.hide(); });   // dismiss when it loses focus
  overlay.on("close", (e) => { if (!isQuitting) { e.preventDefault(); overlay?.hide(); } });
}

async function summonOverlay() {
  if (!overlay) createOverlay();
  if (overlay!.isVisible()) { overlay!.hide(); return; }
  await ensureAccessibility();                 // one-time macOS permission for selection capture
  const selection = await captureSelection();  // clipboard-swap; "" if nothing highlighted
  // Center on the display under the cursor so it appears where the user is working.
  try {
    const pt = screen.getCursorScreenPoint();
    const disp = screen.getDisplayNearestPoint(pt);
    const b = overlay!.getBounds();
    overlay!.setPosition(Math.round(disp.workArea.x + (disp.workArea.width - b.width) / 2), Math.round(disp.workArea.y + disp.workArea.height * 0.28));
  } catch { /* default position */ }
  overlay!.show();
  overlay!.focus();
  overlay!.webContents.send("overlay:summon", { selection });
}

// Run an overlay action through the embedded server's cascade (Phase 1). Pure-generation
// actions never touch tools; anything that returns "pending" is handed to the main window
// where the approval gate lives — the overlay can never trigger a dangerous tool on its own.
async function runOverlayAction(payload: { action: string; selection: string; freeform?: string }): Promise<{ text?: string; route?: any; pending?: boolean }> {
  const message = buildPrompt(payload.action as OverlayAction, payload.selection || "", payload.freeform || "");
  if (!message.trim()) return { text: "" };
  try {
    const r = await fetch(`http://localhost:${PORT}/api/command`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const d: any = await r.json();
    if (d?.kind === "pending") { win?.show(); win?.focus(); return { pending: true }; }
    return { text: d?.text || "", route: d?.route };
  } catch (e: any) { return { text: `Couldn't reach SAM: ${e?.message || e}` }; }
}

// Single-instance lock: if SAM is already running (the common "already installed / launched twice"
// conflict — two servers fighting over port 8787), don't start a second copy. Just focus the one
// that's open. This is the clean fix for install/launch conflicts.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    else createWindow();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  // Updates. electron-updater's silent self-update works on Windows even unsigned. On macOS it needs
  // a SIGNED zip target (Squirrel.Mac) — an UNSIGNED mac build throws "ZIP file not provided" as an
  // unhandledRejection on every launch that finds an update. So on macOS we skip it and use the
  // GitHub-release notifier (a one-click Download dialog) instead — no crash, and it actually works.
  // (When the mac build is signed + ships a zip, re-enable electron-updater here.)
  setTimeout(() => {
    void (async () => {
      if (process.platform === "darwin") { void checkForUpdates(); return; }
      try {
        const { autoUpdater } = await import("electron-updater");
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;   // downloads quietly, installs on quit
        autoUpdater.on("error", () => void checkForUpdates());   // any hiccup → notifier
        await autoUpdater.checkForUpdatesAndNotify();
      } catch { void checkForUpdates(); }
    })();
  }, 8000);

  ipcMain.on("open-studio", () => {
    const studioWin = new BrowserWindow({
      width: 1400,
      height: 900,
      webPreferences: {
        preload: path.join(__dirname, "preload.mjs"),
        nodeIntegration: false,
        contextIsolation: true,
      },
      titleBarStyle: 'hiddenInset',
      vibrancy: 'sidebar',
      backgroundColor: '#00000000', // transparent for vibrancy
    });

    if (process.env.VITE_DEV_SERVER_URL) {
      studioWin.loadURL(`${process.env.VITE_DEV_SERVER_URL}?app=studio`);
    } else {
      studioWin.loadFile(path.join(__dirname, "../dist/index.html"), { search: "app=studio" });
    }
  });

  // ── Overlay wiring (Phase 4) ──
  createOverlay();
  ipcMain.handle("overlay:run", (_e, payload) => runOverlayAction(payload));
  ipcMain.handle("overlay:copy", (_e, text: string) => { clipboard.writeText(String(text || "")); return true; });
  ipcMain.handle("overlay:paste", async (_e, text: string) => { overlay?.hide(); await pasteBack(String(text || "")); return true; });
  ipcMain.handle("overlay:run-as-task", (_e, task: string) => {
    overlay?.hide(); win?.show(); win?.focus();
    // Hand the task to the main window — the full agent + approval gate live there.
    win?.webContents.send("sam:prefill", String(task || ""));
    return true;
  });
  ipcMain.on("overlay:hide", () => overlay?.hide());

  // Global hotkey — summon the lightweight overlay (⌥Space). The main window opens from the tray.
  const okAlt = globalShortcut.register("Option+Space", () => void summonOverlay());
  if (!okAlt) globalShortcut.register("CommandOrControl+Shift+Space", () => void summonOverlay());   // fallback if ⌥Space is taken

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      win?.show();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // Overridden to stay alive in background mode
});
