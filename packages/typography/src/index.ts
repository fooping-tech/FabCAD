/**
 * @fabcad/typography — text to outline engine: semantic text + font → closed glyph loops
 * (`Curve2` from @fabcad/geometry). Knows nothing about documents, sketches or the DOM.
 * See the README for the coordinate conventions and the browser set-up.
 */
export type {
  FontCategory,
  FontInfo,
  GlyphPlacement,
  HorizontalAlign,
  TextLayout,
  TextLayoutRequest,
  TextPath,
  Typography,
  TypographyCapabilities,
  TypographyOptions,
  VerticalAlign,
} from "./types";
export { BUNDLED_FONTS, DEFAULT_FONT_ID, USER_FONT_PREFIX, bundledFont, isUserFontId } from "./catalog";
export { FontError, FontMissingError, TypographyError } from "./errors";
export { DEFAULT_LINE_SPACING } from "./layout";
export { createTypography } from "./typography";
