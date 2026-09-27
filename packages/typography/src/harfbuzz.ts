/**
 * Minimal binding to the HarfBuzz WebAssembly binary that ships in the `harfbuzzjs` package
 * (`harfbuzzjs/dist/harfbuzz.wasm`).
 *
 * The JavaScript entry point of harfbuzzjs locates and loads its wasm file itself (through
 * `import.meta.url`) and keeps one global module. This package instead receives the wasm bytes
 * from the caller and instantiates them with the plain WebAssembly API, which works unchanged
 * on the browser main thread, in Web Workers and in Node, needs no bundler configuration and
 * keeps every Typography instance independent.
 */

export interface ShapedGlyph {
  glyphId: number;
  /** UTF-16 offset of the first character of the cluster in the shaped string. */
  cluster: number;
  /** Font units, Y up. */
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
}

export interface HarfBuzzFont {
  shape(text: string, vertical: boolean): ShapedGlyph[];
  destroy(): void;
}

export interface HarfBuzz {
  createFont(sfnt: ArrayBuffer): HarfBuzzFont;
}

type Fn = (...args: number[]) => number;

const REQUIRED = [
  "malloc",
  "free",
  "hb_blob_create",
  "hb_blob_destroy",
  "hb_face_create",
  "hb_face_destroy",
  "hb_font_create",
  "hb_font_destroy",
  "hb_buffer_create",
  "hb_buffer_destroy",
  "hb_buffer_add_utf16",
  "hb_buffer_set_direction",
  "hb_buffer_set_script",
  "hb_buffer_set_language",
  "hb_buffer_guess_segment_properties",
  "hb_buffer_get_length",
  "hb_buffer_get_glyph_infos",
  "hb_buffer_get_glyph_positions",
  "hb_language_from_string",
  "hb_shape",
] as const;

type Exports = Record<(typeof REQUIRED)[number], Fn>;

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_DIRECTION_TTB = 6;
const GLYPH_INFO_SIZE = 20;
const GLYPH_POSITION_SIZE = 20;
const FEATURE_SIZE = 16;
const FEATURE_GLOBAL_END = 0xffffffff;
const PAGE = 65536;
const MAX_HEAP = 2147483648;

const tag = (s: string): number =>
  ((s.charCodeAt(0) & 0xff) << 24) |
  ((s.charCodeAt(1) & 0xff) << 16) |
  ((s.charCodeAt(2) & 0xff) << 8) |
  (s.charCodeAt(3) & 0xff);

export async function createHarfBuzz(wasm: ArrayBuffer): Promise<HarfBuzz> {
  const module = await WebAssembly.compile(wasm);
  let memory: WebAssembly.Memory | null = null;

  // The binary is an Emscripten build with a handful of runtime imports.
  const known: Record<string, (...args: number[]) => number | void> = {
    emscripten_resize_heap: (requested: number): number => {
      if (!memory) return 0;
      const size = requested >>> 0;
      const old = memory.buffer.byteLength;
      if (size <= old) return 1;
      if (size > MAX_HEAP) return 0;
      // Grow by at least 20 % to avoid repeated small growths.
      const target = Math.min(MAX_HEAP, Math.max(size, old * 1.2));
      try {
        memory.grow(Math.ceil((target - old) / PAGE));
        return 1;
      } catch {
        try {
          memory.grow(Math.ceil((size - old) / PAGE));
          return 1;
        } catch {
          return 0;
        }
      }
    },
    _abort_js: (): void => {
      throw new Error("HarfBuzz aborted");
    },
    proc_exit: (code: number): void => {
      throw new Error(`HarfBuzz exited (${code})`);
    },
  };
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.kind !== "function") {
      throw new Error(`Unsupported HarfBuzz wasm import ${imp.module}.${imp.name} (${imp.kind})`);
    }
    // Remaining imports (timers, keep-alive bookkeeping) are not needed for shaping.
    (imports[imp.module] ??= {})[imp.name] = known[imp.name] ?? ((): number => 0);
  }

  const instance = await WebAssembly.instantiate(module, imports);
  const raw = instance.exports;
  const mem = raw["memory"];
  if (!(mem instanceof WebAssembly.Memory)) throw new Error("HarfBuzz wasm exports no memory");
  memory = mem;
  const heap: WebAssembly.Memory = mem;
  for (const name of REQUIRED) {
    if (typeof raw[name] !== "function") throw new Error(`HarfBuzz wasm does not export ${name}`);
  }
  const hb = raw as unknown as Exports;
  const ctors = raw["__wasm_call_ctors"];
  if (typeof ctors === "function") (ctors as () => void)();

  const alloc = (size: number): number => {
    const ptr = hb.malloc(Math.max(size, 1)) >>> 0;
    if (ptr === 0) throw new Error("HarfBuzz is out of memory");
    return ptr;
  };

  const asciiPointer = (s: string): number => {
    const ptr = alloc(s.length + 1);
    const bytes = new Uint8Array(heap.buffer, ptr, s.length + 1);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0x7f;
    bytes[s.length] = 0;
    return ptr;
  };

  const japanese = ((): number => {
    const ptr = asciiPointer("ja");
    const language = hb.hb_language_from_string(ptr, -1);
    hb.free(ptr);
    return language;
  })();

  // vert + vrt2 as global features, written once.
  const verticalFeatures = alloc(FEATURE_SIZE * 2);
  {
    const view = new DataView(heap.buffer);
    ["vert", "vrt2"].forEach((name, i) => {
      const at = verticalFeatures + i * FEATURE_SIZE;
      view.setUint32(at, tag(name), true);
      view.setUint32(at + 4, 1, true);
      view.setUint32(at + 8, 0, true);
      view.setUint32(at + 12, FEATURE_GLOBAL_END, true);
    });
  }

  const createFont = (sfnt: ArrayBuffer): HarfBuzzFont => {
    const data = alloc(sfnt.byteLength);
    new Uint8Array(heap.buffer).set(new Uint8Array(sfnt), data);
    // No destroy callback: the font bytes are freed in destroy() below.
    const blob = hb.hb_blob_create(data, sfnt.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
    const face = hb.hb_face_create(blob, 0);
    const font = hb.hb_font_create(face);
    let alive = true;

    const shape = (text: string, vertical: boolean): ShapedGlyph[] => {
      if (!alive) throw new Error("The HarfBuzz font was destroyed");
      if (text.length === 0) return [];
      const buffer = hb.hb_buffer_create();
      const textPtr = alloc(text.length * 2);
      try {
        const units = new Uint16Array(heap.buffer, textPtr, text.length);
        for (let i = 0; i < text.length; i++) units[i] = text.charCodeAt(i);
        hb.hb_buffer_add_utf16(buffer, textPtr, text.length, 0, text.length);
        if (vertical) {
          hb.hb_buffer_set_direction(buffer, HB_DIRECTION_TTB);
          hb.hb_buffer_set_script(buffer, tag("Hani"));
          hb.hb_buffer_set_language(buffer, japanese);
          hb.hb_shape(font, buffer, verticalFeatures, 2);
        } else {
          hb.hb_buffer_guess_segment_properties(buffer);
          hb.hb_shape(font, buffer, 0, 0);
        }
        const n = hb.hb_buffer_get_length(buffer) >>> 0;
        const infos = hb.hb_buffer_get_glyph_infos(buffer, 0) >>> 0;
        const positions = hb.hb_buffer_get_glyph_positions(buffer, 0) >>> 0;
        const view = new DataView(heap.buffer);
        const out: ShapedGlyph[] = [];
        for (let i = 0; i < n; i++) {
          const info = infos + i * GLYPH_INFO_SIZE;
          const pos = positions + i * GLYPH_POSITION_SIZE;
          out.push({
            glyphId: view.getUint32(info, true),
            cluster: view.getUint32(info + 8, true),
            xAdvance: view.getInt32(pos, true),
            yAdvance: view.getInt32(pos + 4, true),
            xOffset: view.getInt32(pos + 8, true),
            yOffset: view.getInt32(pos + 12, true),
          });
        }
        return out;
      } finally {
        hb.free(textPtr);
        hb.hb_buffer_destroy(buffer);
      }
    };

    const destroy = (): void => {
      if (!alive) return;
      alive = false;
      hb.hb_font_destroy(font);
      hb.hb_face_destroy(face);
      hb.hb_blob_destroy(blob);
      hb.free(data);
    };

    return { shape, destroy };
  };

  return { createFont };
}
