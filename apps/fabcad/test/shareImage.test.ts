import { describe, expect, it, vi } from "vitest";
import { shareImage } from "../src/app/shareImage";

const file = new File(["png"], "view.png", { type: "image/png" });

describe("share image", () => {
  it("hands the file to the share sheet on a phone", async () => {
    const share = vi.fn(async () => undefined);
    expect(await shareImage(file, { share, canShare: () => true }, true)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [file] });
  });

  it("leaves a computer to its download", async () => {
    const share = vi.fn(async () => undefined);
    expect(await shareImage(file, { share, canShare: () => true }, false)).toBe("failed");
    expect(share).not.toHaveBeenCalled();
  });

  it("falls back when files cannot be shared", async () => {
    expect(await shareImage(file, {}, true)).toBe("failed");
    expect(await shareImage(file, { share: async () => undefined, canShare: () => false }, true)).toBe("failed");
  });

  it("tells a closed sheet from a refused one", async () => {
    const refuse = (name: string) => ({
      canShare: () => true,
      share: async () => {
        throw new DOMException("no", name);
      },
    });
    expect(await shareImage(file, refuse("AbortError"), true)).toBe("cancelled");
    expect(await shareImage(file, refuse("NotAllowedError"), true)).toBe("failed");
  });
});
