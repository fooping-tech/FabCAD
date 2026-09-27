# @fabcad/typography

Text → outline engine. Takes semantic text (string, font id, size, alignment, …) and returns the
glyph outlines as closed loops of `Curve2` from `@fabcad/geometry`, ready to become sketch profiles.

- Outlines: [opentype.js](https://github.com/opentypejs/opentype.js) 1.3.4.
- Shaping (kerning, ligatures, vertical alternates `vert` / `vrt2`): HarfBuzz, the WebAssembly
  binary of the `harfbuzzjs` package.
- No DOM, no `window`, no Node imports, no knowledge of CAD documents or sketches. Runs on the
  browser main thread, in a Web Worker and in Node. Everything that touches the network or the
  file system is injected by the caller.
- No global state: every `createTypography()` instance has its own font cache and its own
  HarfBuzz instance. Results are deterministic.

## Usage

```ts
import { createTypography, DEFAULT_FONT_ID } from "@fabcad/typography";

const typography = createTypography({ loadFontFile, loadHarfBuzzWasm });
await typography.ensureFont(DEFAULT_FONT_ID);          // async: download + parse, once
const layout = typography.layout({                     // sync afterwards
  text: "設計から、切れるデータまで。",
  fontId: DEFAULT_FONT_ID,
  height: 10,
});
layout.loops;   // Curve2[][], closed
layout.bounds;  // Bounds2 | null
layout.missing; // characters without a glyph
```

### In the app (Vite)

```ts
import hbWasmUrl from "harfbuzzjs/dist/harfbuzz.wasm?url";

const typography = createTypography({
  loadFontFile: async (file) => {
    const response = await fetch(`${import.meta.env.BASE_URL}fonts/${file}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  },
  loadHarfBuzzWasm: async () => {
    const response = await fetch(hbWasmUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  },
});
```

- The fonts are served from `apps/fabcad/public/fonts/` (`<base>fonts/<file>`).
- `apps/fabcad/package.json` needs `@fabcad/typography` and `harfbuzzjs` as dependencies (the
  second one only for the `?url` import of the wasm file).
- **No change to `vite.config.ts` is needed.** This package never imports the JavaScript of
  harfbuzzjs: it instantiates the wasm bytes it is given with the plain `WebAssembly` API
  (`src/harfbuzz.ts`). There is therefore nothing for Vite to pre-bundle or exclude
  (`optimizeDeps.exclude` is only needed when `import "harfbuzzjs"` is used, as TypeFab does).
  opentype.js is an ordinary dependency that Vite pre-bundles.
- The same code works in a Web Worker.

### In Node (tests)

```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const bytes = (path: string): ArrayBuffer => new Uint8Array(readFileSync(path)).buffer;

createTypography({
  loadFontFile: async (file) => bytes(`apps/fabcad/public/fonts/${file}`),
  loadHarfBuzzWasm: async () => bytes(require.resolve("harfbuzzjs/dist/harfbuzz.wasm")),
});
```

## API

| | |
| --- | --- |
| `createTypography(options)` | New engine. `options.loadFontFile(file)` is required, `options.loadHarfBuzzWasm()` optional. |
| `listFonts()` | Bundled fonts, then the registered user fonts. |
| `ensureFont(id)` | Loads and caches a font; waits for HarfBuzz. Rejects with `FontMissingError` (unknown id, user font not registered here) or `FontError` (download / parse failed; a later call retries). |
| `isLoaded(id)` | Whether `layout()` can be called for the font. |
| `layout(request)` | Synchronous. Throws `FontMissingError` when the font is not loaded, `TypographyError` for invalid numbers or a path without length. |
| `registerUserFont(name, bytes)` | TTF / OTF / WOFF. Synchronous. Returns the `FontInfo` with id `user:<hash of the bytes>`; the same file always gets the same id. Throws `FontError`. |
| `removeUserFont(id)` | Forgets a user font. |
| `ready()` | Resolves when HarfBuzz initialisation has finished. Never rejects. |
| `capabilities` | `{ shaping, shapingError }`. `shaping` becomes true once HarfBuzz is initialised (after `ready()` or the first `ensureFont()`). |
| `BUNDLED_FONTS`, `DEFAULT_FONT_ID`, `bundledFont(id)`, `isUserFontId(id)` | Font catalog. |

Without HarfBuzz (no loader, or it failed — see `capabilities.shapingError`) the layout falls back
to opentype.js: one glyph per character with pair kerning, vertical text without alternates.

## Conventions

### Coordinates

Millimetres, X to the right, Y up. Glyphs are never mirrored. Contours keep the orientation they
have in the font (TrueType: outer contours clockwise, holes counter-clockwise; CFF and some
fonts the other way round). Outer contours and holes are not classified and overlapping contours
are not merged: that is the job of the profile builder.

### `height`

`height` is the **font size**: the em square of the font is scaled to `height` millimetres
(`scale = height / unitsPerEm`), like the text height in Fusion. It is *not* the height of a
capital letter: in the bundled fonts a capital "H" is 0.70–0.82 × `height` tall, and a
full-width kanji advances by exactly `height`.

### Anchor (text without a path)

The anchor selected by `horizontalAlign` / `verticalAlign` is at the origin (0, 0).

Horizontal text:

- `left` (default): every line starts at x = 0. `center`: every line is centred on x = 0.
  `right`: every line ends at x = 0. The width of a line is the sum of its advances (not the ink).
- `baseline` (default): the baseline of the first line is y = 0. `top`: the ascender line of the
  first line is y = 0. `bottom`: the descender line of the last line is y = 0. `middle`: halfway
  between those two. Ascender and descender come from the font (`hhea`).
- Further lines follow below, `lineSpacing × height` apart (default 1.2).

Vertical text (`vertical: true`):

- Glyphs run from top to bottom, columns from right to left, `lineSpacing × height × stretch`
  apart. Every glyph is centred on the axis of its column.
- `top` (default, also used for `baseline`): every column starts at y = 0, i.e. the top of the em
  box of the first glyph. `middle` / `bottom`: every column is centred on / ends at y = 0.
- `left` (default): the left edge of the block (the last column) is x = 0; with one column its
  axis is at x = `height × stretch / 2`. `center`: the block is centred on x = 0. `right`: the
  right edge of the first column is x = 0.
- `vert` and `vrt2` are applied (ー、。「」 and small kana get their vertical forms). Kanji and
  Latin letters stay upright unless the font itself substitutes rotated forms. There is no
  tate-chu-yoko.
- HarfBuzz hangs glyphs without a `VORG` entry from the font's ascender, which lies above the em
  box. Those glyphs are hung from the top of the em box instead, so that a column really starts
  at y = 0. (TypeFab does not do this; its columns start 0.28 em lower with the bundled fonts.)

### Spacing and stretch

- `spacing` (mm) is added after every character cluster, also between a letter and a space, but
  not after the last one of a line. `GlyphPlacement.advance` does not include it.
- `stretch` (percent) scales glyphs and advances in X; `spacing` is not scaled. In vertical text
  glyphs are stretched about the axis of their column.

### Text on a path

`path.curves` is a connected chain of `line`, `arc` (also a full circle), `ellipseArc` and
`bezier` curves. The chain is parameterised by arc length (exact for lines and arcs, a length
table with linear interpolation for the others).

- The flat layout is wrapped onto the path: the position along the line becomes the arc length,
  the height above the baseline becomes the distance to the left of the travel direction.
- **Every glyph is rigid.** The point of the baseline in the middle of the glyph's advance is
  placed on the path (plus `offset`), and the glyph is rotated about that point to the tangent
  there. `GlyphPlacement.origin` is therefore half an advance *behind* that point along the
  tangent: `origin + rotate((advance / 2, 0), rotation)` is the point on the path.
- `offset`: distance of the baseline from the path, positive to the left of the travel direction
  (towards the centre of a counter-clockwise arc).
- `align` (default: `horizontalAlign` of the request): `left` starts at the beginning of the path,
  `center` centres the line on the middle of the path, `right` ends at the end of the path.
  `start` (mm) is added to that position in all three cases.
- `flip` reverses the travel direction. The text then starts at the other end and, because left
  and right swap, stands on the other side of the path.
- `verticalAlign` moves the text across the path: `baseline` puts the baseline on the path,
  `top` the ascender line, `bottom` the descender line. Further lines follow to the right of the
  travel direction.
- Open path: text that is longer than the path (or starts before it) continues straight along
  the tangent at the end. Nothing is clipped. Closed path (end point = start point, e.g. a full
  circle): positions wrap around; text longer than the path overlaps itself.
- `vertical` is ignored on a path.

### Outline quality

Every loop in `TextLayout.loops`:

- is closed: the end point of each curve is identical (`===` on both coordinates) to the start
  point of the next one, and the last curve ends at the start of the first;
- consists of `line` and cubic `bezier` curves only. TrueType quadratics are raised to cubics
  exactly; nothing is flattened;
- has no zero-length segments. Contours without area (a single point, a line there and back) are
  dropped.

Compare the stored points (`line.b`, `bezier.p3`), not `curveEnd()`: `curveEnd()` of a line
interpolates `a + (b - a) × 1`, which can differ from `b` in the last bit.

### Missing glyphs

Characters the font has no glyph for are listed in `TextLayout.missing`. They keep their advance
(that of `.notdef`) but produce no outline — the `.notdef` box is never turned into geometry.
There is no fallback to another font.

### Clusters

`GlyphPlacement.cluster` is the UTF-16 offset in `request.text`; `text` is the source text of the
cluster. One placement is returned per glyph, so a cluster with several glyphs (base + mark)
appears several times and a ligature appears once with the text of all its characters.

## Fonts

`BUNDLED_FONTS` lists the eight fonts in `apps/fabcad/public/fonts/` (all OFL-1.1, see
`THIRD_PARTY_FONTS.md`). The ids are the ones TypeFab uses.

User fonts are parsed in memory only. They are not stored, uploaded or embedded anywhere by this
package. A document should store the font id and the generated outlines; when the font is not
registered in the current browser, `ensureFont()` rejects with `FontMissingError` and the app can
keep showing the stored outlines and ask for the file.

WOFF is unpacked with a built-in inflate, table by table, so `GSUB`, `vmtx` etc. survive.

## Limitations

- No bidirectional text. A line is shaped as one run; its direction and script are guessed from
  the first strong character (vertical text: script `Hani`, language `ja`).
- No WOFF2, no font collections (TTC). Variable fonts are used at their default instance.
- No font fallback, no colour or bitmap glyphs.
- Latin text in vertical columns is upright, not rotated.
- Glyph outlines may overlap (within some glyphs, or neighbouring glyphs with negative spacing
  or tight curves on a path).
