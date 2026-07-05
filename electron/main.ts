import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Start the Express backend directly in the main process!
// It will boot up and listen on 8787 automatically.
import "../server/index.ts";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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

app.whenReady().then(() => {
  createWindow();
  createTray();

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
