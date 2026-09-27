/** Base class of every error thrown by this package. */
export class TypographyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypographyError";
  }
}

/** A font could not be loaded or parsed. */
export class FontError extends TypographyError {
  constructor(message: string) {
    super(message);
    this.name = "FontError";
  }
}

/**
 * The requested font is not available in this instance: an unknown id, a user font that is not
 * registered in this browser, or a bundled font that has not been loaded with `ensureFont()` yet.
 */
export class FontMissingError extends FontError {
  readonly fontId: string;

  constructor(fontId: string, message?: string) {
    super(message ?? `Font "${fontId}" is not available. Load it with ensureFont() or register the user font again.`);
    this.name = "FontMissingError";
    this.fontId = fontId;
  }
}
