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

/** The separation of the eyes in dots, for an image `width` dots wide. */
export const eyesFor = (width: number): number => Math.min(120, Math.max(24, Math.round(width / 6)));

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
 * The dots (0 or 1, `width` × `heights.length / width`). `noise` holds one free dot per pixel:
 * a fixed pattern keeps the image from shimmering while the view turns.
 */
export const randomDots = (heights: Float32Array, width: number, eyes: number, noise: Uint8Array): Uint8Array => {
  const rows = Math.floor(heights.length / width);
  const dots = new Uint8Array(width * rows);
  const same = new Int32Array(width);
  for (let y = 0; y < rows; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) same[x] = x;
    for (let x = 0; x < width; x++) {
      const s = dotSeparation(heights[row + x]!, eyes);
      let left = x - (s >> 1);
      let right = left + s;
      if (left < 0 || right >= width) continue;
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
    for (let x = width - 1; x >= 0; x--) {
      dots[row + x] = same[x] === x ? noise[row + x]! : dots[row + same[x]!]!;
    }
  }
  return dots;
};
