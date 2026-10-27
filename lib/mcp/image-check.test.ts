import { describe, expect, it } from "vitest";
import { decodeBase64Strict, sniffImage } from "@/lib/mcp/image-check";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const WEBP = [
  0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
];

const bytes = (values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("sniffImage", () => {
  it("recognises PNG, JPEG, GIF and WebP", () => {
    expect(sniffImage(bytes(PNG))).toEqual({
      mimeType: "image/png",
      ext: "png",
    });
    expect(sniffImage(bytes(JPEG))).toEqual({
      mimeType: "image/jpeg",
      ext: "jpg",
    });
    expect(sniffImage(bytes(GIF))).toEqual({
      mimeType: "image/gif",
      ext: "gif",
    });
    expect(sniffImage(bytes(WEBP))).toEqual({
      mimeType: "image/webp",
      ext: "webp",
    });
  });

  it("refuses SVG, text, HTML and empty input", () => {
    expect(
      sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))
    ).toBeNull();
    expect(sniffImage(text("<?xml version='1.0'?><svg/>"))).toBeNull();
    expect(sniffImage(text("hello"))).toBeNull();
    expect(sniffImage(text("<html><script>1</script></html>"))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });

  it("refuses a RIFF file that is not WebP", () => {
    const wav = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45];
    expect(sniffImage(bytes(wav))).toBeNull();
  });

  it("goes by the bytes, not the file name", () => {
    // A PNG that a client calls "photo.gif" is still a PNG.
    expect(sniffImage(bytes(PNG))?.ext).toBe("png");
  });
});

describe("decodeBase64Strict", () => {
  const b64 = (values: number[]) => Buffer.from(values).toString("base64");

  it("decodes valid base64", () => {
    const res = decodeBase64Strict(b64(PNG), 1000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.from(res.bytes)).toEqual(PNG);
    }
  });

  it("rejects characters outside the base64 alphabet", () => {
    expect(decodeBase64Strict("aGVs bG8=", 1000)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(decodeBase64Strict("aGVsbG8*", 1000)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(decodeBase64Strict("data:image/png;base64,AAAA", 1000)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(decodeBase64Strict("", 1000)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects padding in the wrong place", () => {
    expect(decodeBase64Strict("aGV=sbG8", 1000).ok).toBe(false);
    expect(decodeBase64Strict("aGVsbG8", 1000).ok).toBe(false);
  });

  it("checks the size before decoding", () => {
    const decodeSpy = (Buffer as unknown as { from: typeof Buffer.from }).from;
    const original = Buffer.from;
    let calls = 0;
    Buffer.from = ((...args: unknown[]) => {
      calls += 1;
      return (decodeSpy as (...a: unknown[]) => Buffer)(...args);
    }) as typeof Buffer.from;
    try {
      // 4 MB of base64 is about 3 MB decoded, over a 1 MB limit.
      const res = decodeBase64Strict("A".repeat(4 * 1024 * 1024), 1024 * 1024);
      expect(res).toEqual({ ok: false, reason: "too_large" });
      expect(calls).toBe(0);
    } finally {
      Buffer.from = original;
    }
  });

  it("accepts exactly the limit", () => {
    const res = decodeBase64Strict(Buffer.from("abc").toString("base64"), 3);
    expect(res.ok).toBe(true);
    expect(
      decodeBase64Strict(Buffer.from("abcd").toString("base64"), 3)
    ).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});
