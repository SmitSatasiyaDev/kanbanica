// Image type detection by magic bytes, plus strict base64 decoding. MCP clients
// send no MIME type or file name, and we never trust one anyway: the type, the
// extension and the stored name all come from the bytes.

export type SniffedImage = {
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  ext: "png" | "jpg" | "gif" | "webp";
};

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  return signature.every((value, i) => bytes[offset + i] === value);
}

// Returns the image type for PNG, JPEG, GIF and WebP, and null for everything
// else. SVG is text that can carry scripts, so it is refused on purpose.
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: "image/png", ext: "png" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mimeType: "image/jpeg", ext: "jpg" };
  }
  // "GIF8" (GIF87a and GIF89a).
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { mimeType: "image/gif", ext: "gif" };
  }
  // "RIFF" at 0 and "WEBP" at 8.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { mimeType: "image/webp", ext: "webp" };
  }
  return null;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export type Base64Result =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "invalid" | "too_large" };

// Decodes standard base64 strictly. Anything that is not base64 is refused
// (no data: URLs, no whitespace inside, no URL-safe alphabet). The decoded size
// is worked out from the text length and checked BEFORE anything is decoded, so
// an oversized payload never allocates its decoded buffer.
export function decodeBase64Strict(
  input: string,
  maxBytes: number
): Base64Result {
  const text = input.trim();
  // Padded base64 only: the length is always a multiple of four.
  if (text.length === 0 || text.length % 4 !== 0) {
    return { ok: false, reason: "invalid" };
  }

  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const decodedSize = Math.floor((text.length * 3) / 4) - padding;
  if (decodedSize > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  if (!BASE64_PATTERN.test(text)) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, bytes: new Uint8Array(Buffer.from(text, "base64")) };
}
