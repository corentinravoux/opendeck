// Builds the deck runtime copied into every deck as lib/: opendeck.js, opendeck.css, fonts/.
// A plain (non-library) build, so fonts are emitted as files rather than inlined in the CSS.
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "../src/opendeck/_web/runtime",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: "src/runtime/viewer.ts",
      output: {
        format: "iife",
        entryFileNames: "opendeck.js",
        assetFileNames: (info) =>
          (info.names ?? []).some((n) => n.endsWith(".css")) ? "opendeck.css" : "fonts/[name]-[hash][extname]",
      },
    },
  },
});
