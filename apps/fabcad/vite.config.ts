import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// GitHub Pages serves the app from https://<user>.github.io/FabCAD/. Override with
// FABCAD_BASE=/ for hosting at a domain root.
const base = process.env.FABCAD_BASE ?? "/FabCAD/";

export default defineConfig({
  base,
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: "es2022",
    outDir: "../../dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    // Emscripten output; pre-bundling breaks the wasm loader.
    exclude: ["replicad-opencascadejs"],
  },
  server: {
    fs: { allow: ["../.."] },
  },
});
