/** What `Navigator` must offer to hand a file to the share sheet. */
export type FileSharing = Pick<Navigator, "canShare" | "share">;

/**
 * Hand `file` to the share sheet of a phone or tablet, the only way from a web page into the
 * photo library. "failed" leaves the file to a download, "cancelled" means the user closed the
 * sheet. A computer has a pointer that is not coarse and keeps its usual download.
 */
export async function shareImage(
  file: File,
  sharing: Partial<FileSharing>,
  coarsePointer: boolean,
): Promise<"shared" | "cancelled" | "failed"> {
  if (!coarsePointer || !sharing.share || !sharing.canShare?.({ files: [file] })) return "failed";
  try {
    await sharing.share({ files: [file] });
    return "shared";
  } catch (e) {
    return e instanceof DOMException && e.name === "AbortError" ? "cancelled" : "failed";
  }
}
