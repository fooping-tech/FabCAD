#!/usr/bin/env node
/**
 * Collect license texts for lockfile production dependencies and publish them
 * alongside the browser bundle. This complements (but does not replace) a
 * compiled-bundle / linked-native-library legal review.
 */
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const allowed = new Set(["MIT", "ISC", "LGPL-2.1-only"]);
const deps = Object.entries(lock.packages ?? {})
  .filter(([path, value]) =>
    path.startsWith("node_modules/") &&
    !value.link && !value.dev && !value.devOptional
  ).map(([path, value]) => ({
    path,
    name: path.slice("node_modules/".length),
    version: value.version,
    license: value.license,
  })).sort((a, b) => a.name.localeCompare(b.name));

assert.ok(deps.length > 0, "No production dependencies were found");
const report = [];
const licenseText = [
  "FabCAD third-party runtime package licenses",
  "",
  "Generated from package-lock.json and exact installed npm package contents.",
  "The LGPL dependencies and native WebAssembly sources have additional",
  "redistribution conditions; refer to THIRD_PARTY_NOTICES.md in the repository.",
  "This inventory does not certify all binary transitive dependencies.",
  "",
];
for (const { path, name, version, license } of deps) {
  assert.ok(allowed.has(license), `Unexpected or missing license for ${name}: ${license}`);
  const directory = join(root, path);
  const names = await readdir(directory);
  const noticeFiles = names.filter(n => /^(?:licen[sc]e|copying|notice)(?:[._-].*)?$/i.test(n)).sort();
  assert.ok(noticeFiles.length > 0, `Missing license notice file for ${name}`);
  const notices = [];
  for (const filename of noticeFiles) {
    const raw = await readFile(join(directory, filename), "utf8");
    assert.ok(raw.trim().length >= 60, `Empty license notice ${name}/${filename}`);
    notices.push({ filename, text: raw });
  }
  report.push({ name, version, license, noticeFiles });
  licenseText.push("=" .repeat(72));
  licenseText.push(`${name}@${version}  (SPDX: ${license})`);
  for (const notice of notices) {
    licenseText.push(`-- ${name}/${notice.filename} --`);
    licenseText.push(notice.text.trimEnd());
  }
  licenseText.push("");
}
await writeFile(join(root, "dist/THIRD_PARTY_LICENSES.txt"), licenseText.join("\n"));
await writeFile(join(root, "dist/third-party-components.json"), JSON.stringify(report, null, 2) + "\n");

// Vite copies these fonts to the live GitHub Pages output. Verify that every
// embedded TTF is accompanied by its own unmodified OFL text and that both
// files actually survive the production build.
const bundledFontDir = join(root, "apps/fabcad/public/fonts");
const publishedFontDir = join(root, "dist/fonts");
const fontFiles = await readdir(bundledFontDir);
const ttfs = fontFiles.filter(n => n.endsWith("-Regular.ttf")).sort();
assert.ok(ttfs.length >= 8, `Expected at least 8 bundled fonts, found ${ttfs.length}`);
for (const filename of ttfs) {
  const licenseName = filename.replace(/-Regular\.ttf$/, "-OFL.txt");
  assert.ok(fontFiles.includes(licenseName), `Missing OFL beside bundled font ${filename}`);
  for (const assetName of [filename, licenseName]) {
    const originalBytes = await readFile(join(bundledFontDir, assetName));
    const publishedBytes = await readFile(join(publishedFontDir, assetName));
    assert.ok(originalBytes.equals(publishedBytes),
      `Published font/OFL bytes differ from checked-in original: ${assetName}`);
  }
}

console.log(JSON.stringify({
  status: "runtime dependency notice files found and exported (not a legal certification)",
  total: report.length,
  fontOflPairsVerified: ttfs.length,
  licenses: Object.fromEntries([...allowed].map(l => [l, report.filter(p => p.license === l).length])),
  documents: ["dist/THIRD_PARTY_LICENSES.txt", "dist/third-party-components.json"],
}, null, 2));
