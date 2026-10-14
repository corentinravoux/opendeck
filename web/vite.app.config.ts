// Builds the editor app served by the local server at / (assets under /assets/).
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/app",
  base: "/",
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: {
    outDir: "../../../src/opendeck/_web/app",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8765", "/view": "http://127.0.0.1:8765" },
  },
});
