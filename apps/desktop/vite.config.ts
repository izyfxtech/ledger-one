import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Vite + React SPA (used as the frontend for a Tauri shell).
export default defineConfig({
  // Relative asset URLs: the same build works from a site root, a sub-path,
  // or inside Tauri. Routing is hash-based, so no server rewrites are needed.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "::",
    port: 8080,
    strictPort: true,
  },
  clearScreen: false,
});
