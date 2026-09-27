import { FontError } from "./errors";
import { inflateZlib } from "./inflate";

const TAG_WOFF = 0x774f4646; // "wOFF"
const TAG_WOFF2 = 0x774f4632; // "wOF2"
const TAG_TRUETYPE = 0x00010000;
const TAG_TRUE = 0x74727565; // "true"
const TAG_OTTO = 0x4f54544f; // "OTTO"
const TAG_TTC = 0x74746366; // "ttcf"

const MAX_FONT_BYTES = 64 * 1024 * 1024;

/**
 * Returns the font as plain SFNT (TTF / OTF) bytes. WOFF 1 is unpacked table by table, so every
 * OpenType table (GSUB with vert/vrt2, vmtx, …) is preserved. Throws FontError for anything else.
 */
export function toSfnt(data: ArrayBuffer): ArrayBuffer {
  if (data.byteLength < 12) throw new FontError("The file is too small to be a font.");
  if (data.byteLength > MAX_FONT_BYTES) throw new FontError("The font file is larger than 64 MB.");
  const view = new DataView(data);
  const tag = view.getUint32(0);
  switch (tag) {
    case TAG_TRUETYPE:
    case TAG_TRUE:
    case TAG_OTTO:
      return data;
    case TAG_WOFF:
      return unpackWoff(data, view);
    case TAG_WOFF2:
      throw new FontError("WOFF2 fonts are not supported. Use the TTF, OTF or WOFF version of the font.");
    case TAG_TTC:
      throw new FontError("Font collections (TTC) are not supported. Use a single TTF or OTF file.");
    default:
      throw new FontError("The file is not a TTF, OTF or WOFF font.");
  }
}

function unpackWoff(data: ArrayBuffer, input: DataView): ArrayBuffer {
  if (data.byteLength < 44) throw new FontError("The WOFF file is truncated.");
  const count = input.getUint16(12);
  const size = input.getUint32(16);
  if (count < 1 || count > 4096 || size > MAX_FONT_BYTES || 44 + count * 20 > data.byteLength) {
    throw new FontError("The WOFF header is invalid.");
  }
  let needed = 12 + 16 * count;
  for (let i = 0; i < count; i++) needed += Math.ceil(input.getUint32(44 + i * 20 + 12) / 4) * 4;
  if (needed > MAX_FONT_BYTES) throw new FontError("The WOFF header is invalid.");
  // Some encoders declare a smaller total size than the padded tables need; size the buffer ourselves.
  const out = new ArrayBuffer(Math.max(size, needed));
  const view = new DataView(out);
  const dest = new Uint8Array(out);
  view.setUint32(0, input.getUint32(4));
  view.setUint16(4, count);
  const power = Math.floor(Math.log2(count));
  view.setUint16(6, 16 * 2 ** power);
  view.setUint16(8, power);
  view.setUint16(10, count * 16 - 16 * 2 ** power);
  let offset = 12 + 16 * count;
  for (let i = 0; i < count; i++) {
    const from = 44 + i * 20;
    const to = 12 + i * 16;
    const src = input.getUint32(from + 4);
    const compressed = input.getUint32(from + 8);
    const length = input.getUint32(from + 12);
    if (src + compressed > data.byteLength || compressed > length) {
      throw new FontError("A WOFF table is invalid.");
    }
    const part = new Uint8Array(data, src, compressed);
    if (compressed === length) {
      dest.set(part, offset);
    } else {
      try {
        dest.set(inflateZlib(part, length), offset);
      } catch (e) {
        throw new FontError(`A WOFF table could not be decompressed (${errorMessage(e)}).`);
      }
    }
    view.setUint32(to, input.getUint32(from));
    view.setUint32(to + 4, input.getUint32(from + 16));
    view.setUint32(to + 8, offset);
    view.setUint32(to + 12, length);
    offset += Math.ceil(length / 4) * 4;
  }
  return out;
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Stable content hash (two FNV-1a passes, 64 bits as hex) used for user font ids. */
export function hashBytes(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    h1 = Math.imul(h1 ^ b, 0x01000193);
    h2 = Math.imul(h2 ^ ((b + i) & 0xff), 0x85ebca6b);
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h1) + hex(h2);
}
