import { contextBridge, ipcRenderer } from "electron";

// Expose safe APIs to the React renderer process
contextBridge.exposeInMainWorld("samDesktop", {
  isNative: true,
  openStudio: () => ipcRenderer.send("open-studio"),
});
