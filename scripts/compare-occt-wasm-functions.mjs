#!/usr/bin/env node
/**
 * Compare *function bodies* inside the WebAssembly code section (section 10).
 * The function indices here are defined-function ordinals; imported functions
 * are deliberately excluded. This is provenance diagnostic evidence ONLY.
 */
import { createHash } from "node:crypto";

const WASM_HEADER = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

function varuint32(buffer, cursor, limit = buffer.length) {
  let n = 0;
  for (let i = 0; i < 5; i += 1) {
    if (cursor + i >= limit) throw new Error("Truncated WASM unsigned LEB128");
    const byte = buffer[cursor + i];
    n += (byte & 127) * 2 ** (i * 7);
    if (!(byte & 128)) {
      if (n > 0xffffffff) throw new Error("WASM unsigned LEB128 overflow");
      return { value: n, next: cursor + i + 1 };
    }
  }
  throw new Error("WASM unsigned LEB128 exceeds 5 bytes");
}
function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
function codeBodies(input) {
  const b = Buffer.from(input);
  if (b.length < 8 || !b.subarray(0, 8).equals(WASM_HEADER)) {
    throw new Error("Invalid WASM magic/version");
  }
  let cursor = 8;
  let codePayload = null;
  let codeEnd = 0;
  while (cursor < b.length) {
    const id = b[cursor++];
    const size = varuint32(b, cursor);
    const start = size.next;
    const end = start + size.value;
    if (end > b.length) throw new Error("Truncated WASM section");
    if (id === 10) {
      if (codePayload !== null) throw new Error("Multiple code sections");
      codePayload = start;
      codeEnd = end;
    }
    cursor = end;
  }
  if (codePayload === null) throw new Error("WASM code section is absent");
  const count = varuint32(b, codePayload, codeEnd);
  if (count.value > (codeEnd - count.next)) {
    throw new Error("Invalid WASM function body count");
  }
  cursor = count.next;
  const functions = [];
  for (let i = 0; i < count.value; i += 1) {
    const size = varuint32(b, cursor, codeEnd);
    const end = size.next + size.value;
    if (end > codeEnd) throw new Error("Truncated WASM function body");
    functions.push({
      ordinal: i,
      offset: size.next,
      sizeBytes: size.value,
      body: b.subarray(size.next, end),
    });
    cursor = end;
  }
  if (cursor !== codeEnd) throw new Error("Trailing bytes in WASM code section");
  return functions;
}

export function compareWasmFunctionBodies(original, rebuilt, maxReported = 24) {
  if (!Number.isInteger(maxReported) || maxReported < 0 || maxReported > 1000) {
    throw new Error("Invalid maxReported");
  }
  const before = codeBodies(original);
  const after = codeBodies(rebuilt);
  const mismatches = [];
  let changed = 0;
  let added = 0;
  let removed = 0;
  let changeDelta = 0;
  const total = Math.max(before.length, after.length);
  for (let i = 0; i < total; i += 1) {
    const left = before[i], right = after[i];
    if (left && right && left.body.equals(right.body)) continue;
    changed += 1;
    if (!left) added += 1;
    if (!right) removed += 1;
    changeDelta += (right?.sizeBytes ?? 0) - (left?.sizeBytes ?? 0);
    if (mismatches.length >= maxReported) continue;
    let firstDifferentByteInBody = null;
    if (left && right) {
      const min = Math.min(left.sizeBytes, right.sizeBytes);
      for (let k = 0; k < min; k += 1) {
        if (left.body[k] !== right.body[k]) {
          firstDifferentByteInBody = k;
          break;
        }
      }
      if (firstDifferentByteInBody === null && left.sizeBytes !== right.sizeBytes) {
        firstDifferentByteInBody = min;
      }
    }
    mismatches.push({
      definedFunctionOrdinal: i,
      originalSizeBytes: left?.sizeBytes ?? null,
      rebuiltSizeBytes: right?.sizeBytes ?? null,
      originalBodySha256: left ? sha256(left.body) : null,
      rebuiltBodySha256: right ? sha256(right.body) : null,
      firstDifferentByteInBody,
      originalAbsoluteOffset: left?.offset ?? null,
      rebuiltAbsoluteOffset: right?.offset ?? null,
      firstDifferentBytes: firstDifferentByteInBody === null ? null : {
        originalHex: left.body.subarray(
          Math.max(0, firstDifferentByteInBody - 8), firstDifferentByteInBody + 16,
        ).toString("hex"),
        rebuiltHex: right.body.subarray(
          Math.max(0, firstDifferentByteInBody - 8), firstDifferentByteInBody + 16,
        ).toString("hex"),
      },
    });
  }
  return {
    originalDefinedFunctionCount: before.length,
    rebuiltDefinedFunctionCount: after.length,
    changedDefinedFunctionCount: changed,
    addedDefinedFunctions: added,
    removedDefinedFunctions: removed,
    sumChangedBodySizeDeltaBytes: changeDelta,
    reportedLimit: maxReported,
    firstChangedFunctions: mismatches,
    qualification: "Differences are binary diagnostics only. Function ordinal is not an imported-function-adjusted WASM index. Source/build provenance and LGPL correspondence are separate questions.",
  };
}
