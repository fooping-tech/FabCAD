import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig } from "vite";
import { agentGuideHtml, agentGuideMarkdown } from "./src/agents/guide";
import { HELP } from "./src/help/content";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// GitHub Pages serves the app from https://<user>.github.io/FabCAD/. Override with
// FABCAD_BASE=/ for hosting at a domain root.
const base = process.env.FABCAD_BASE ?? "/FabCAD/";

const page = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// A custom OCCT binary is permitted only as an explicit build/development opt-in.
// Avoid silently publishing a build that references a nonexistent replacement.
if (process.env.VITE_FABCAD_OCCT_WASM_OVERRIDE === "1" &&
    !existsSync(page("public/occt-override.wasm"))) {
  throw new Error("VITE_FABCAD_OCCT_WASM_OVERRIDE=1 requires apps/fabcad/public/occt-override.wasm");
}

/**
 * The guide for AI agents, generated from the in-app help: `llms.txt` (Markdown) and
 * `agents/index.html`. The dev server builds it on each request, so it follows edits of the help.
 */
function agentGuide(): Plugin {
  type Guide = typeof import("./src/agents/guide");
  type Help = typeof import("./src/help/content");
  return {
    name: "fabcad-agent-guide",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        const markdown = path === `${base}llms.txt`;
        const html = path === `${base}agents/` || path === `${base}agents/index.html`;
        if (!markdown && !html) return next();
        try {
          const guide = (await server.ssrLoadModule("/src/agents/guide.ts")) as Guide;
          const help = (await server.ssrLoadModule("/src/help/content.ts")) as Help;
          res.setHeader("Content-Type", markdown ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8");
          res.end(markdown ? guide.agentGuideMarkdown(help.HELP) : guide.agentGuideHtml(help.HELP));
        } catch (err) {
          next(err);
        }
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "llms.txt", source: agentGuideMarkdown(HELP) });
      this.emitFile({ type: "asset", fileName: "agents/index.html", source: agentGuideHtml(HELP) });
    },
  };
}

// Two pages: "/" is the landing page, "/app/" the CAD itself.
export default defineConfig({
  base,
  plugins: [react(), agentGuide()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: "es2022",
    outDir: "../../dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        landing: page("index.html"),
        app: page("app/index.html"),
      },
    },
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
