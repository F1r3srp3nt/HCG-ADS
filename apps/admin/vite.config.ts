import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.VITE_API_TARGET ?? "http://127.0.0.1:7800";

export default defineConfig({
  base: "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/admin": { target, changeOrigin: true },
      "/delivery": { target, changeOrigin: true },
      "/testbed": { target, changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
