import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: ["playwright-core", "pdf-parse", "mammoth", "fsevents"],
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
      },
    }),
  ],
  server: {
    port: 5273,
    proxy: {
      // HUD talks to the SAM brain on :8787
      "/api": "http://localhost:8787",
    },
  },
});
