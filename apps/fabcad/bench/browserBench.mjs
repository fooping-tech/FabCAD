/**
 * Recompute benchmark in real browsers: opens the benchmark projects (`makeModels.ts`) in two
 * running dev servers (e.g. before and after a change) and measures, per project:
 * opening (full recompute), editing a late and an early fillet, the peak resident memory of the
 * browser's processes, one autosave write, and (where Stop exists) stopping a computation and
 * resuming it.
 *
 * Needs Playwright (not a dependency of the repo): `npm i -D playwright` in a scratch folder
 * and run from there, or `npx -p playwright node apps/fabcad/bench/browserBench.mjs`.
 *
 *   npx vite-node apps/fabcad/bench/makeModels.ts /tmp/bench
 *   BEFORE_URL=http://127.0.0.1:5174/FabCAD/app/ AFTER_URL=http://127.0.0.1:5173/FabCAD/app/ \
 *     node apps/fabcad/bench/browserBench.mjs /tmp/bench chromium 3
 *
 * STEPS=20,80 limits the projects; NO_RECOVERY=1 leaves out Stop (its second worker raises the
 * peak memory).
 */
import { chromium, webkit } from "playwright";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [modelDir = "bench-out", engineName = "chromium", runs = "3"] = process.argv.slice(2);
const browserType = engineName === "webkit" ? webkit : chromium;
const procMatch = engineName === "webkit" ? "ms-playwright/webkit" : "ms-playwright/chromium";
const servers = {
  before: process.env.BEFORE_URL ?? "http://127.0.0.1:5174/FabCAD/app/",
  after: process.env.AFTER_URL ?? "http://127.0.0.1:5173/FabCAD/app/",
};
const NO_RECOVERY = process.env.NO_RECOVERY === "1";
const STEPS = (process.env.STEPS ?? "20,80,200").split(",").map(Number);

/** Resident memory of the browser's processes (MB): all of them, and the largest one. */
function memory() {
  const rows = execSync("ps -axo rss=,command=", { maxBuffer: 1 << 24 }).toString().split("\n")
    .filter((l) => l.includes(procMatch)).map((l) => Number(l.trim().split(/\s+/)[0]) / 1024);
  return { total: rows.reduce((a, b) => a + b, 0), largest: Math.max(0, ...rows) };
}

async function measure(version, steps) {
  const json = readFileSync(`${modelDir}/bench-${steps}.fabcad.json`, "utf8");
  const browser = await browserType.launch(engineName === "chromium" ? { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  let peak = { total: 0, largest: 0 };
  const sampler = setInterval(() => { const m = memory(); peak = { total: Math.max(peak.total, m.total), largest: Math.max(peak.largest, m.largest) }; }, 200);
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    page.on("console", (m) => m.text().startsWith("bench:") && console.log("  ", version, steps, m.text()));
    page.on("pageerror", (e) => console.log("  pageerror", e.message));
    await page.goto(servers[version]);
    await page.waitForTimeout(1500);
    const box = page.getByText("利用規約に同意し");
    if (await box.count()) { await box.click(); await page.getByRole("button", { name: "FabCADを使い始める" }).click(); }
    await page.waitForFunction(() => { const s = window.__fabcad?.modelState.get(); return s && s.kernel === "ready" && !s.restoring && !s.busy; }, null, { timeout: 120000 });
    const idle = memory();
    const r = await page.evaluate(async ({ json, noRecovery }) => {
      const { modelState, documentStore } = window.__fabcad;
      const session = await import("/FabCAD/src/app/session.ts");
      const untilIdle = (act) => new Promise((resolve, reject) => {
        const t0 = performance.now();
        let seen = false;
        const finish = (r) => { off(); clearTimeout(limit); clearTimeout(none); resolve(r); };
        const check = () => {
          const st = modelState.get();
          if (st.busy) seen = true;
          if (seen && !st.busy && !st.cached) finish({ wall: performance.now() - t0, engine: st.lastDurationMs });
        };
        const off = modelState.subscribe(check);
        const limit = setTimeout(() => { off(); reject(new Error("timeout")); }, 180000);
        // A change that needs no recompute (served from the cache) never sets busy.
        const none = setTimeout(() => !seen && finish({ wall: NaN, engine: NaN, none: true }), 3000);
        Promise.resolve(act()).then(check, reject);
      });
      console.log("bench: opening");
      const open = await untilIdle(() => session.openProjectFile(new File([json], "bench.fabcad.json")));
      const s = modelState.get();
      const errors = Object.values(s.features).filter((f) => f.state === "error").length;
      const fillets = documentStore.document.timeline.filter((id) => documentStore.document.features[id]?.type === "fillet");
      const setRadius = (id, r) => () => documentStore.execute({ label: "radius", apply: (d) => ({ ...d, features: { ...d.features, [id]: { ...d.features[id], radius: r } } }) });
      console.log("bench: opened " + Math.round(open.wall));
      const editLast = await untilIdle(setRadius(fillets.at(-1), "1.5"));
      console.log("bench: edit last " + Math.round(editLast.wall));
      const editFirst = await untilIdle(setRadius(fillets[0], "1.5"));
      console.log("bench: edit first " + Math.round(editFirst.wall));
      // Autosave of this project: serialize + one IndexedDB write, as each version does it.
      const p = await import("/FabCAD/src/app/persistence.ts");
      const text = JSON.stringify({ format: "fabcad", document: documentStore.document });
      const saves = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        if (p.currentAutosaveToken) await p.storeAutosave(text, await p.currentAutosaveToken());
        else await p.storeAutosave(text);
        saves.push(performance.now() - t0);
      }
      saves.sort((a, b) => a - b);
      // Recovery (only the version with Stop): stop in the middle of a full recompute, restart, resume.
      let recovery = null;
      if (session.stopCadWorker && !noRecovery) {
        setRadius(fillets[0], "1.25")();
        await new Promise((r) => setTimeout(r, 30));
        const t0 = performance.now();
        await session.stopCadWorker();
        const restart = performance.now() - t0;
        const resume = await untilIdle(() => session.resumeRecompute());
        recovery = { restart, resume: resume.wall, errors: Object.values(modelState.get().features).filter((f) => f.state === "error").length };
        console.log("bench: recovery " + JSON.stringify(recovery));
      }
      return { recovery, open, editLast, editFirst, errors, bodies: Object.keys(s.bodies).length, jsonKB: text.length / 1024, autosaveMs: saves[2] };
    }, { json, noRecovery: NO_RECOVERY });
    return { ...r, idleMB: idle.total, peakMB: peak.total, peakLargestMB: peak.largest };
  } finally {
    clearInterval(sampler);
    await browser.close();
  }
}

const results = [];
for (const steps of STEPS) for (let run = 0; run < Number(runs); run++) for (const version of ["before", "after"]) {
  let r;
  try { r = await measure(version, steps); } catch (e) { console.log(engineName, version, steps, run, "FAILED", e.message); continue; }
  results.push({ engine: engineName, version, steps, run, ...r });
  console.log(engineName, version, steps, run, JSON.stringify({ open: Math.round(r.open.wall), engineOpen: r.open.engine, editLast: Math.round(r.editLast.wall), editFirst: Math.round(r.editFirst.wall), errors: r.errors, peakMB: Math.round(r.peakMB), autosaveMs: r.autosaveMs.toFixed(1), jsonKB: r.jsonKB.toFixed(0) }));
}
writeFileSync(`${modelDir}/results-${engineName}.json`, JSON.stringify(results, null, 1));
