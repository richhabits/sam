import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      // HUD talks to the SAM brain on :8787
      "/api": "http://localhost:8787",
    },
  },
});
