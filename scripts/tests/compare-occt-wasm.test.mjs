import assert from "node:assert/strict";
import test from "node:test";
import { compareWasmSections, readWasmSections } from "../compare-occt-wasm.mjs";

const magic = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
function leb32(value) {
  const result = [];
  do {
    let part = value & 0x7f;
    value >>>= 7;
    if (value) part |= 0x80;
    result.push(part);
  } while (value);
  return Buffer.from(result);
}
function section(id, contents) {
  const payload = Buffer.from(contents);
  return Buffer.concat([Buffer.from([id]), leb32(payload.length), payload]);
}
function custom(name, value) {
  const label = Buffer.from(name);
  return section(0, Buffer.concat([leb32(label.length), label, Buffer.from(value)]));
}
function wasm(...sections) {
  return Buffer.concat([magic, ...sections]);
}
const code = section(10, [0]);

test("identical binaries have no section changes", () => {
  const a = wasm(custom("producers", [1]), code);
  const result = compareWasmSections(a, a);
  assert.equal(result.byteIdentical, true);
  assert.equal(result.firstDifferenceOffset, null);
  assert.equal(result.coreSectionsByteIdentical, true);
  assert.deepEqual(result.customSectionChanges, []);
});

test("custom metadata differences do not change core-section identity", () => {
  const a = wasm(custom("build_id", [1]), code);
  const b = wasm(custom("build_id", [2, 3, 4]), code);
  const result = compareWasmSections(a, b);
  assert.equal(result.byteIdentical, false);
  assert.equal(result.sizeDifferenceBytes, 2);
  assert.equal(result.coreSectionsByteIdentical, true);
  assert.equal(result.nonCustomSectionChanges.length, 0);
  assert.equal(result.customSectionChanges.length, 1);
  assert.equal(result.customSectionChanges[0].customName, "build_id");
});

test("a changed code section is not dismissed as a metadata difference", () => {
  const a = wasm(custom("source", [1]), section(10, [0]));
  const b = wasm(custom("source", [1]), section(10, [1]));
  const result = compareWasmSections(a, b);
  assert.equal(result.coreSectionsByteIdentical, false);
  assert.equal(result.nonCustomSectionChanges.length, 1);
  assert.equal(result.nonCustomSectionChanges[0].section, "code");
});

test("added custom sections and reordered core sections are detected", () => {
  const a = wasm(section(1, [0]), code);
  const b = wasm(section(10, [0]), custom("producers", [1]), section(1, [0]));
  const result = compareWasmSections(a, b);
  assert.equal(result.customSectionChanges.length, 1);
  assert.equal(result.coreSectionsByteIdentical, false);
});

test("truncated and invalid binary layouts fail closed", () => {
  assert.throws(() => readWasmSections(Buffer.from([0, 97, 115, 109])), /magic or version/);
  assert.throws(() => readWasmSections(wasm(Buffer.from([10, 5, 0]))), /Truncated WASM section/);
  assert.throws(() => readWasmSections(wasm(Buffer.from([0, 1, 128]))), /varuint32/);
});
