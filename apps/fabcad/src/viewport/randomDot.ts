/**
 * Random-dot autostereogram (Thimbleby, Inglis and Witten, 1994): one image of dots in which
 * pairs of dots, one separation apart, are the same. Looking through the image, each pair merges
 * into one point whose distance follows from the separation.
 */

/** How far the far side of the model stands in front of the background (0 to 1). */
const MODEL_BASE = 0.35;
/** Depth of field: the share of the distance to the image that the depth may span. */
const DEPTH_OF_FIELD = 1 / 3;

/** The separation of a point at `height` (0: the background, 1: the nearest), in dots. */
export const dotSeparation = (height: number, eyes: number): number => {
  const z = DEPTH_OF_FIELD * height;
  return Math.round(((1 - z) * eyes) / (2 - z));
};

/** The separation of the eyes in pixels of the view, for a view `width` pixels wide. */
export const eyesFor = (width: number): number => Math.min(240, Math.max(48, Math.round(width / 6)));

/** View distances (Infinity: nothing there) to heights: see `dotSeparation`. */
export const heightsOf = (depth: Float32Array): Float32Array => {
  let near = Infinity;
  let far = -Infinity;
  for (const d of depth) {
    if (d === Infinity) continue;
    if (d < near) near = d;
    if (d > far) far = d;
  }
  const span = far - near;
  const out = new Float32Array(depth.length);
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]!;
    if (d === Infinity) continue;
    out[i] = span > 0 ? MODEL_BASE + ((1 - MODEL_BASE) * (far - d)) / span : 1;
  }
  return out;
};

/**
 * The dots of an image `width` × `heights.length / width`, each 0 to `fine` (black to white).
 * `noise` holds one free dot (0 or 1) per pixel: a fixed pattern keeps the image from shimmering
 * while the view turns. Each row is worked out `fine` times wider than it is shown, so the
 * separation can end inside a dot, whose grey then shows where: depth finer than a pixel.
 */
export const randomDots = (
  heights: Float32Array,
  width: number,
  eyes: number,
  noise: Uint8Array,
  fine = 1,
): Uint8Array => {
  const rows = Math.floor(heights.length / width);
  const dots = new Uint8Array(width * rows);
  const wide = width * fine;
  const same = new Int32Array(wide);
  const line = new Uint8Array(wide);
  for (let y = 0; y < rows; y++) {
    const row = y * width;
    for (let x = 0; x < wide; x++) same[x] = x;
    for (let pixel = 0; pixel < width; pixel++) {
      const s = dotSeparation(heights[row + pixel]!, eyes * fine);
      for (let x = pixel * fine; x < (pixel + 1) * fine; x++) {
        let left = x - (s >> 1);
        let right = left + s;
        if (left < 0 || right >= wide) continue;
        // Keep the links of a row consistent when two pairs want the same dot.
        let k = same[left]!;
        while (k !== left && k !== right) {
          if (k < right) {
            left = k;
          } else {
            left = right;
            right = k;
          }
          k = same[left]!;
        }
        same[left] = right;
      }
    }
    for (let pixel = width - 1; pixel >= 0; pixel--) {
      let sum = 0;
      for (let x = (pixel + 1) * fine - 1; x >= pixel * fine; x--) {
        const to = same[x]!;
        sum += line[x] = to === x ? noise[row + pixel]! : line[to]!;
      }
      dots[row + pixel] = sum;
    }
  }
  return dots;
};

/** A change of slope or a jump of height, across `gap` dots, that counts as an outline. */
const OUTLINE = 0.0008;
/** How much lower than its neighbours a point of an outline may be. */
const JUMP = 0.02;

/**
 * Which dots carry an outline (1: yes): the silhouette, the steps and the creases of `heights`.
 * Both dots of the pair of an outline point are marked, so the two eyes see it at its depth.
 */
export const outlineDots = (heights: Float32Array, width: number, eyes: number, gap: number): Uint8Array => {
  const rows = Math.floor(heights.length / width);
  const out = new Uint8Array(width * rows);
  // At a jump only the near side counts: the far side lies at another depth, a second outline.
  const bends = (i: number, step: number): boolean => {
    const before = heights[i - step]!;
    const after = heights[i + step]!;
    const here = heights[i]!;
    return Math.abs(before - 2 * here + after) > OUTLINE && here >= Math.max(before, after) - JUMP;
  };
  for (let y = gap; y < rows - gap; y++) {
    for (let x = gap; x < width - gap; x++) {
      const i = y * width + x;
      if (!bends(i, gap) && !bends(i, gap * width)) continue;
      const s = dotSeparation(heights[i]!, eyes);
      const left = x - (s >> 1);
      const right = left + s;
      if (left < 0 || right >= width) continue;
      out[y * width + left] = 1;
      out[y * width + right] = 1;
    }
  }
  return out;
};
