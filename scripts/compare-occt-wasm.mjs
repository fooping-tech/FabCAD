#!/usr/bin/env node
/**
 * Inspect the binary layout of two WebAssembly modules.
 *
 * This is a diagnostic comparison, not a source-provenance or LGPL
 * compliance determination. Equal non-custom sections do not prove
 * identical upstream sources or compiler inputs.
 */
import { createHash } from "node:crypto";

const MAGIC = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const SECTION_NAMES = [
  "custom", "type", "import", "function", "table", "memory", "global",
  "export", "start", "element", "code", "data", "data-count", "tag",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readVarUint32(bytes, at, limit) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    if (at + i >= limit) throw new Error("Truncated WASM varuint32");
    const octet = bytes[at + i];
    value += (octet & 0x7f) * (2 ** (7 * i));
    if (!(octet & 0x80)) {
      if (value > 0xffffffff) throw new Error("WASM varuint32 overflow");
      return { value, next: at + i + 1 };
    }
  }
  throw new Error("Invalid WASM varuint32");
}

export function readWasmSections(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < MAGIC.length || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Invalid WebAssembly magic or version");
  }
  const occurrences = new Map();
  const sections = [];
  let offset = MAGIC.length;
  while (offset < bytes.length) {
    const start = offset;
    const id = bytes[offset++];
    const length = readVarUint32(bytes, offset, bytes.length);
    const payloadStart = length.next;
    const end = payloadStart + length.value;
    if (!Number.isSafeInteger(end) || end > bytes.length) {
      throw new Error("Truncated WASM section");
    }
    let customName = null;
    if (id === 0) {
      const nameLength = readVarUint32(bytes, payloadStart, end);
      const nameEnd = nameLength.next + nameLength.value;
      if (nameEnd > end) throw new Error("Truncated WASM custom section name");
      customName = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes.subarray(nameLength.next, nameEnd));
    }
    const identity = String(id) + ":" + (customName ?? "");
    const count = occurrences.get(identity) ?? 0;
    occurrences.set(identity, count + 1);
    sections.push({
      id,
      name: SECTION_NAMES[id] ?? "unknown",
      customName,
      occurrence: count,
      identity: identity + ":" + String(count),
      sizeBytes: end - start,
      payloadBytes: length.value,
      sha256: sha256(bytes.subarray(start, end)),
    });
    offset = end;
  }
  return sections;
}

function changedSections(beforeSections, afterSections, custom) {
  const beforeMap = new Map(beforeSections.filter(s => (s.id === 0) === custom).map(s => [s.identity, s]));
  const afterMap = new Map(afterSections.filter(s => (s.id === 0) === custom).map(s => [s.identity, s]));
  const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];
  return keys.flatMap(key => {
    const a = beforeMap.get(key);
    const b = afterMap.get(key);
    if (a && b && a.sha256 === b.sha256) return [];
    const section = a ?? b;
    return [{
      section: section.name,
      id: section.id,
      customName: section.customName,
      occurrence: section.occurrence,
      before: a ? { sizeBytes: a.sizeBytes, sha256: a.sha256 } : null,
      after: b ? { sizeBytes: b.sizeBytes, sha256: b.sha256 } : null,
    }];
  });
}

export function compareWasmSections(beforeInput, afterInput) {
  const before = Buffer.from(beforeInput);
  const after = Buffer.from(afterInput);
  const original = readWasmSections(before);
  const rebuilt = readWasmSections(after);
  let firstDifferenceOffset = null;
  const limit = Math.min(before.length, after.length);
  for (let i = 0; i < limit; i += 1) {
    if (before[i] !== after[i]) {
      firstDifferenceOffset = i;
      break;
    }
  }
  if (firstDifferenceOffset === null && before.length !== after.length) {
    firstDifferenceOffset = limit;
  }
  const nonCustomSectionChanges = changedSections(original, rebuilt, false);
  const customSectionChanges = changedSections(original, rebuilt, true);
  const coreSequence = sections => sections.filter(s => s.id !== 0).map(s => s.identity);
  const sameCoreOrder = JSON.stringify(coreSequence(original)) === JSON.stringify(coreSequence(rebuilt));
  return {
    byteIdentical: before.equals(after),
    sizeDifferenceBytes: after.length - before.length,
    firstDifferenceOffset,
    originalSectionCount: original.length,
    rebuiltSectionCount: rebuilt.length,
    coreSectionsByteIdentical: sameCoreOrder && nonCustomSectionChanges.length === 0,
    nonCustomSectionChanges,
    customSectionChanges,
    // Offsets and surrounding bytes help distinguish structural changes,
    // but are not evidence that a library was rebuilt from matching sources.
    firstDifferenceHex: firstDifferenceOffset === null ? null : {
      original: before.subarray(Math.max(0, firstDifferenceOffset - 8), firstDifferenceOffset + 16).toString("hex"),
      rebuilt: after.subarray(Math.max(0, firstDifferenceOffset - 8), firstDifferenceOffset + 16).toString("hex"),
    },
  };
}
