import assert from "node:assert/strict";
import test from "node:test";
import { compareWasmFunctionBodies } from "../compare-occt-wasm-functions.mjs";
const header = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
function leb(n) {
  const result = [];
  do {
    let b = n & 127;
    n = Math.floor(n / 128);
    if (n) b |= 128;
    result.push(b);
  } while (n);
  return Buffer.from(result);
}
function encodeBody(bytes) {
  return Buffer.concat([leb(bytes.length), Buffer.from(bytes)]);
}
function wasm(...bodies) {
  const contents = Buffer.concat([leb(bodies.length), ...bodies.map(encodeBody)]);
  return Buffer.concat([header, Buffer.from([10]), leb(contents.length), contents]);
}
test("identifies changed function ordinal, size and first differing byte", () => {
  const a = wasm([0, 11], [0, 1, 11]);
  const b = wasm([0, 11], [0, 2, 99, 11]);
  const result = compareWasmFunctionBodies(a, b);
  assert.equal(result.changedDefinedFunctionCount, 1);
  assert.equal(result.sumChangedBodySizeDeltaBytes, 1);
  assert.equal(result.firstChangedFunctions[0].definedFunctionOrdinal, 1);
  assert.equal(result.firstChangedFunctions[0].firstDifferentByteInBody, 1);
  assert.notEqual(result.firstChangedFunctions[0].originalBodySha256, result.firstChangedFunctions[0].rebuiltBodySha256);
});
test("unchanged functions are not reported", () => {
  const a = wasm([0, 11], [0, 1, 11]);
  const result = compareWasmFunctionBodies(a, a);
  assert.equal(result.changedDefinedFunctionCount, 0);
  assert.deepEqual(result.firstChangedFunctions, []);
});
test("added functions are counted and bounded report still counts every difference", () => {
  const a = wasm([0, 11]);
  const b = wasm([0, 11], [0, 1, 11], [0, 2, 11]);
  const result = compareWasmFunctionBodies(a, b, 1);
  assert.equal(result.addedDefinedFunctions, 2);
  assert.equal(result.changedDefinedFunctionCount, 2);
  assert.equal(result.firstChangedFunctions.length, 1);
});
test("rejects invalid and truncated function-body content", () => {
  assert.throws(() => compareWasmFunctionBodies(Buffer.alloc(0), wasm([0, 11])), /Invalid WASM/);
  assert.throws(() => compareWasmFunctionBodies(wasm([0, 11]).subarray(0, -1), wasm([0, 11])), /Truncated WASM/);
  assert.throws(() => compareWasmFunctionBodies(header, wasm([0, 11])), /code section is absent/);
});
