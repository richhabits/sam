import { contextBridge } from "electron";

// Expose safe APIs to the React renderer process
contextBridge.exposeInMainWorld("samDesktop", {
  isNative: true,
});
