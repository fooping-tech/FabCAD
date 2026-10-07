/**
 * Share links: the project (the same JSON as Save), compressed, in the fragment of the URL
 * (`#project=v1.…`). Browsers do not send the fragment to the server, so the model stays out of
 * every HTTP request. Pure functions apart from the browser's CompressionStream.
 */

/** The longest link that is made or opened: 1 MiB of characters. */
export const SHARE_LINK_LIMIT = 1_048_576;

/** A decompressed project larger than this is refused (a small link must not unpack forever). */
const MAX_PROJECT_CHARS = 64 * 1_048_576;

const PREFIX = "project=";
const VERSION = "v1";

export class ShareLinkError extends Error {
  override name = "ShareLinkError";
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await out.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await out.cancel();
      throw new ShareLinkError("The project in the link is too large to open.");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return all;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new ShareLinkError("The link is damaged: it contains characters a share link never has.");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ShareLinkError("The link is damaged: its data cannot be read.");
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** The fragment (with `#`) that carries a project. */
export async function encodeShareFragment(projectJson: string): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(projectJson), new CompressionStream("deflate-raw"));
  return `#${PREFIX}${VERSION}.${toBase64Url(packed)}`;
}

/** True when the fragment (`location.hash`) is meant to carry a project, valid or not. */
export const isShareFragment = (hash: string): boolean => hash.replace(/^#/, "").startsWith(PREFIX);

/**
 * The project JSON in a share fragment. Throws `ShareLinkError` with a reason a person can read
 * for a fragment that is too long, damaged or from a newer version of FabCAD.
 */
export async function decodeShareFragment(hash: string): Promise<string> {
  if (hash.length > SHARE_LINK_LIMIT) {
    throw new ShareLinkError("The link is longer than 1 MiB, the most a share link can carry.");
  }
  const body = hash.replace(/^#/, "");
  if (!body.startsWith(PREFIX)) throw new ShareLinkError("The link does not contain a project.");
  const rest = body.slice(PREFIX.length);
  const dot = rest.indexOf(".");
  const version = dot < 0 ? "" : rest.slice(0, dot);
  if (version !== VERSION) {
    throw new ShareLinkError(
      /^v\d+$/.test(version)
        ? `The link was made by a newer version of FabCAD (share link ${version}).`
        : "The link is damaged: it does not say how its project is stored.",
    );
  }
  const bytes = fromBase64Url(rest.slice(dot + 1));
  let unpacked: Uint8Array;
  try {
    unpacked = await pipe(bytes, new DecompressionStream("deflate-raw"), MAX_PROJECT_CHARS);
  } catch (err) {
    if (err instanceof ShareLinkError) throw err;
    throw new ShareLinkError("The link is damaged: its data cannot be unpacked. It may have been cut off when it was copied.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(unpacked);
  } catch {
    throw new ShareLinkError("The link is damaged: its data is not text.");
  }
}

/**
 * A link to `base` (the address of the app, without fragment) that opens the project, or why
 * there is none: a link longer than `SHARE_LINK_LIMIT` is not made.
 */
export async function makeShareLink(
  base: string,
  projectJson: string,
): Promise<{ ok: true; url: string } | { ok: false; length: number }> {
  const url = base.replace(/#.*$/, "") + (await encodeShareFragment(projectJson));
  return url.length > SHARE_LINK_LIMIT ? { ok: false, length: url.length } : { ok: true, url };
}
