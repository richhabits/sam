// MUST be first: sets CJS globals, crash visibility, and the writable data dir BEFORE the server
// module below evaluates. (ES imports evaluate in source order, so preboot runs before the server.)
import "./preboot.ts";

import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, dialog, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Start the Express backend in this process (boots + listens on 8787). STATIC import so the electron
// build's `external` (better-sqlite3) applies and the native module loads from node_modules rather
// than being bundled and losing its .node. preboot.ts (imported first, above) has already set the
// data dir + CJS globals it needs.
import "../server/index.ts";

// Tell the embedded server which packaged version it is, so /api/update-check can compare against
// the latest GitHub RELEASE (not git) and show an in-app "update available" banner on packaged builds.
try { process.env.SAM_APP_VERSION = app.getVersion(); } catch { /* dev */ }

let win: BrowserWindow | null = null;
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

function createTray() {
  // Use a native empty icon or a tiny colored dot for the tray
  // For a real app, you would load an image file here
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('SAM');
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open SAM', click: () => { win?.show(); win?.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
  
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    win?.show();
    win?.focus();
  });
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
  // Updates: try TRUE silent auto-update first (electron-updater + GitHub releases —
  // works when the build is signed on macOS; unsigned Windows NSIS also updates fine).
  // If it can't (unsigned mac build, dev run), fall back to the polite notifier.
  setTimeout(() => {
    void (async () => {
      try {
        const { autoUpdater } = await import("electron-updater");
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;   // downloads quietly, installs on quit
        autoUpdater.on("error", () => void checkForUpdates());   // unsigned/dev → notifier
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

  // Global hotkey to summon SAM
  globalShortcut.register("Option+Space", () => {
    if (win) {
      if (win.isVisible() && win.isFocused()) {
        win.hide();
      } else {
        win.show();
        win.focus();
      }
    }
  });

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
