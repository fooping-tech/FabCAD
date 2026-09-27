/**
 * Small synchronous zlib (RFC 1950) / DEFLATE (RFC 1951) decoder, used to unpack WOFF tables so
 * that `registerUserFont()` can stay synchronous and work without DecompressionStream.
 * Canonical Huffman decoding in the style of zlib's `puff.c`.
 */

const MAX_BITS = 15;

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

export class InflateError extends Error {}

interface Huffman {
  /** Number of codes of each length. */
  count: Uint16Array;
  /** Symbols ordered by code. */
  symbol: Uint16Array;
}

function buildHuffman(lengths: ArrayLike<number>, n: number): Huffman {
  const count = new Uint16Array(MAX_BITS + 1);
  for (let i = 0; i < n; i++) count[lengths[i] ?? 0]!++;
  // Over-subscribed code sets are invalid; incomplete ones are allowed (single distance code).
  let left = 1;
  for (let len = 1; len <= MAX_BITS; len++) {
    left = (left << 1) - count[len]!;
    if (left < 0) throw new InflateError("invalid Huffman code lengths");
  }
  const offsets = new Uint16Array(MAX_BITS + 2);
  for (let len = 1; len <= MAX_BITS; len++) offsets[len + 1] = offsets[len]! + count[len]!;
  const symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const len = lengths[i] ?? 0;
    if (len !== 0) {
      symbol[offsets[len]!] = i;
      offsets[len]!++;
    }
  }
  return { count, symbol };
}

class BitReader {
  private pos = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(private readonly src: Uint8Array) {}

  bits(need: number): number {
    let value = this.bitBuffer;
    while (this.bitCount < need) {
      if (this.pos >= this.src.length) throw new InflateError("unexpected end of compressed data");
      value |= this.src[this.pos++]! << this.bitCount;
      this.bitCount += 8;
    }
    this.bitBuffer = value >>> need;
    this.bitCount -= need;
    return value & ((1 << need) - 1);
  }

  decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= this.bits(1);
      const count = h.count[len]!;
      if (code - count < first) return h.symbol[index + (code - first)]!;
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new InflateError("invalid Huffman code");
  }

  /** Discard the rest of the current byte and return the byte position. */
  alignToByte(): number {
    this.bitBuffer = 0;
    this.bitCount = 0;
    return this.pos;
  }

  seek(pos: number): void {
    this.pos = pos;
  }
}

let fixedTables: { lit: Huffman; dist: Huffman } | null = null;

function fixedHuffman(): { lit: Huffman; dist: Huffman } {
  if (fixedTables) return fixedTables;
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  const dist = new Uint8Array(30).fill(5);
  // Immutable lookup tables; caching them is not observable state.
  fixedTables = { lit: buildHuffman(lengths, 288), dist: buildHuffman(dist, 30) };
  return fixedTables;
}

/** Decode a raw DEFLATE stream into a buffer of exactly `size` bytes. */
export function inflateRaw(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let outPos = 0;
  const reader = new BitReader(src);
  let last = false;
  while (!last) {
    last = reader.bits(1) === 1;
    const type = reader.bits(2);
    if (type === 0) {
      const at = reader.alignToByte();
      if (at + 4 > src.length) throw new InflateError("unexpected end of compressed data");
      const len = src[at]! | (src[at + 1]! << 8);
      const nlen = src[at + 2]! | (src[at + 3]! << 8);
      if ((len ^ 0xffff) !== nlen) throw new InflateError("invalid stored block");
      if (at + 4 + len > src.length) throw new InflateError("unexpected end of compressed data");
      if (outPos + len > size) throw new InflateError("decompressed data is larger than declared");
      out.set(src.subarray(at + 4, at + 4 + len), outPos);
      outPos += len;
      reader.seek(at + 4 + len);
      continue;
    }
    let lit: Huffman;
    let dist: Huffman;
    if (type === 1) {
      ({ lit, dist } = fixedHuffman());
    } else if (type === 2) {
      const nlen = reader.bits(5) + 257;
      const ndist = reader.bits(5) + 1;
      const ncode = reader.bits(4) + 4;
      if (nlen > 286 || ndist > 30) throw new InflateError("invalid dynamic block");
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[CODE_LENGTH_ORDER[i]!] = reader.bits(3);
      const codeLengths = buildHuffman(lengths.subarray(0, 19), 19);
      const all = new Uint8Array(nlen + ndist);
      let i = 0;
      while (i < nlen + ndist) {
        const sym = reader.decode(codeLengths);
        if (sym < 16) {
          all[i++] = sym;
          continue;
        }
        let value = 0;
        let repeat: number;
        if (sym === 16) {
          if (i === 0) throw new InflateError("invalid dynamic block");
          value = all[i - 1]!;
          repeat = 3 + reader.bits(2);
        } else if (sym === 17) {
          repeat = 3 + reader.bits(3);
        } else {
          repeat = 11 + reader.bits(7);
        }
        if (i + repeat > nlen + ndist) throw new InflateError("invalid dynamic block");
        while (repeat-- > 0) all[i++] = value;
      }
      if (all[256] === 0) throw new InflateError("dynamic block without end code");
      lit = buildHuffman(all.subarray(0, nlen), nlen);
      dist = buildHuffman(all.subarray(nlen), ndist);
    } else {
      throw new InflateError("invalid block type");
    }
    for (;;) {
      const sym = reader.decode(lit);
      if (sym < 256) {
        if (outPos >= size) throw new InflateError("decompressed data is larger than declared");
        out[outPos++] = sym;
        continue;
      }
      if (sym === 256) break;
      const li = sym - 257;
      if (li >= 29) throw new InflateError("invalid length code");
      const len = LENGTH_BASE[li]! + reader.bits(LENGTH_EXTRA[li]!);
      const di = reader.decode(dist);
      if (di >= 30) throw new InflateError("invalid distance code");
      const distance = DIST_BASE[di]! + reader.bits(DIST_EXTRA[di]!);
      if (distance > outPos) throw new InflateError("invalid distance");
      if (outPos + len > size) throw new InflateError("decompressed data is larger than declared");
      for (let k = 0; k < len; k++) {
        out[outPos] = out[outPos - distance]!;
        outPos++;
      }
    }
  }
  if (outPos !== size) throw new InflateError("decompressed data is smaller than declared");
  return out;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  let i = 0;
  while (i < data.length) {
    const end = Math.min(i + 3800, data.length);
    for (; i < end; i++) {
      a += data[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Decode a zlib stream (as used by WOFF) into exactly `size` bytes; verifies the checksum. */
export function inflateZlib(src: Uint8Array, size: number): Uint8Array {
  if (src.length < 6) throw new InflateError("zlib stream is too short");
  const cmf = src[0]!;
  const flg = src[1]!;
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 0x20) !== 0) {
    throw new InflateError("invalid zlib header");
  }
  const out = inflateRaw(src.subarray(2, src.length - 4), size);
  const n = src.length;
  const expected = ((src[n - 4]! << 24) | (src[n - 3]! << 16) | (src[n - 2]! << 8) | src[n - 1]!) >>> 0;
  if (adler32(out) !== expected) throw new InflateError("zlib checksum mismatch");
  return out;
}
