#!/usr/bin/env node
/**
 * Browser-level verification of the actual built Vite CAD worker and the
 * selected OCCT WASM file. Requires dist/ built with override enabled.
 *
 * This is an optional integration check, not an LGPL compliance verdict.
 * Uses the system Chrome/Chromium via playwright-core.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = join(root, "dist");
const base = "/FabCAD/";
const port = 4198;
const url = \`http://127.0.0.1:${port}\`;
const provenance = JSON.parse(await readFile(join(dist, "occt-wasm-provenance.json"), "utf8"));
assert.equal(provenance.replacementMode, true, "Browser test requires WASM override build");

const assets = await readdir(join(dist, "assets"));
const workers = assets.filter(p => /^cadWorker-[^.]+\\.js$/.test(p));
assert.equal(workers.length, 1, "Expected exactly one Vite CAD worker chunk");
const workerPath = \`${base}assets/${workers[0]}\`;

const server = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
  detached: false,
});
let serverLog = "";
server.stdout.on("data", b => { serverLog += b.toString(); });
server.stderr.on("data", b => { serverLog += b.toString(); });

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("Vite preview exited: " + serverLog);
    try {
      const resp = await fetch(url + base);
      if (resp.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error("Vite preview did not respond: " + serverLog);
}

let browser;
try {
  await waitForServer();
  const chromePath = process.env.CHROME_BIN || "/usr/bin/google-chrome";
  browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const fetches = [];
  page.on("response", response => {
    if (response.url().endsWith("/occt-override.wasm"))
      fetches.push({ url: response.url(), status: response.status() });
  });
  page.on("pageerror", error => { console.error("Browser page error:", error.message); });
  await page.goto(url + base, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async ({ workerPath }) => {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { type: "module" });
      let id = 0;
      const pending = new Map();
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("Browser CAD worker did not respond within 90 seconds"));
      }, 90000);

      const fail = (error) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(String(error.message || error)));
      };
      worker.onerror = fail;
      worker.onmessageerror = fail;
      worker.onmessage = ({ data }) => {
        const p = pending.get(data.id);
        if (!p) return;
        pending.delete(data.id);
        data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
      };
      const request = (payload) => new Promise((res, rej) => {
        id += 1;
        pending.set(id, { resolve: res, reject: rej });
        worker.postMessage({ id, request: payload });
      });

      (async () => {
        const init = await request({ type: "init" });
        if (init.kernel !== "replicad-opencascade") throw new Error("Wrong CAD kernel");
        // An empty but valid CAD document exercises the real browser worker
        // feature-engine execution path, without relying on UI/WebGL.
        const doc = {
          schema: "fabcad.document", version: 1, id: "browser-wasm-smoke",
          name: "Browser WASM smoke", units: { length: "mm", angle: "deg" },
          parameters: [],
          assembly: {
            rootComponentId: "component-root",
            components: { "component-root": { id: "component-root", name: "Root" } },
            instances: {
              "instance-root": {
                id: "instance-root", name: "Root",
                componentId: "component-root",
                parentInstanceId: null,
                transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
                visible: true,
              },
            },
            joints: {}, rigidGroups: {},
          },
          features: {}, timeline: [], timelineCursor: null,
          bodies: {}, origin: { visible: true, hidden: [] },
          extensions: {}, nextId: 1,
        };
        const recomputed = await request({ type: "recompute", document: doc, known: {} });
        if (!recomputed || !Array.isArray(recomputed.bodies))
          throw new Error("Browser feature-engine recompute failed");
        clearTimeout(timeout);
        worker.terminate();
        resolve({ kernel: init.kernel, bodyCount: recomputed.bodies.length });
      })().catch(fail);
    });
  }, { workerPath });
  assert.ok(fetches.length > 0, "Chrome did not request the OCCT override WASM");
  assert.ok(fetches.every(x => x.status === 200), "OCCT override WASM HTTP failure");
  console.log(JSON.stringify({
    status: "browser WASM replacement verified (not an LGPL certification)",
    result,
    workerPath,
    wasmFetches: fetches,
    sha256: provenance.sha256,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
