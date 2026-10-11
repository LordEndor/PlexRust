import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
const src = (p: string) => path.resolve(__dirname, "./src", p);

// `vite build --mode web` makes the browser version: the Tauri APIs and the
// mpv player are swapped for the stand-ins in src/web, everything else is shared.
const webAliases = [
  { find: /^@tauri-apps\/api\/core$/, replacement: src("web/shims/core.ts") },
  { find: /^@tauri-apps\/api\/app$/, replacement: src("web/shims/app.ts") },
  { find: /^@tauri-apps\/plugin-updater$/, replacement: src("web/shims/updater.ts") },
  { find: /^@tauri-apps\/plugin-process$/, replacement: src("web/shims/process.ts") },
  { find: /^@tauri-apps\/plugin-opener$/, replacement: src("web/shims/opener.ts") },
  { find: /^@\/screens\/Player$/, replacement: src("web/WebPlayer.tsx") },
];

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [...(mode === "web" ? webAliases : []), { find: "@", replacement: src("") }],
  },
  // Relative asset paths, so the page works from any folder (GitHub Pages serves it under /PlexRust/).
  base: mode === "web" ? "./" : "/",
  build: mode === "web" ? { outDir: "dist-web" } : undefined,

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
