import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Start the Express backend directly in the main process!
// It will boot up and listen on 8787 automatically.
import "../server/index.ts";

let win: BrowserWindow | null = null;

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
}

app.whenReady().then(() => {
  createWindow();

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
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
