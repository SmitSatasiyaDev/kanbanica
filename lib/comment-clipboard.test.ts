import { describe, expect, it, vi } from "vitest";
import {
  buildCommentClipboardContent,
  type ClipboardAttachment,
  type ClipboardEnv,
  copyCommentToClipboard,
} from "./comment-clipboard";

const ORIGIN = "https://kb.test";
const p = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const img = (key: string, attachmentId?: string) => ({
  type: "noteImage",
  attrs: { fileKey: key, attachmentId: attachmentId ?? null, alt: "shot" },
});
const doc = (...content: unknown[]) => ({ type: "doc", content });
const build = (d: unknown, att: ClipboardAttachment[] = []) =>
  buildCommentClipboardContent(d, att, ORIGIN);

function textOf(blob: Blob) {
  return blob.text();
}

interface Written {
  data: Record<string, Promise<Blob>>;
}

function makeEnv(over: Partial<ClipboardEnv> = {}) {
  const writeText = vi.fn(async () => undefined);
  const write = vi.fn(async (items: unknown[]) => {
    // resolve the promise-valued entries like a real browser would
    for (const v of Object.values((items[0] as Written).data)) {
      await v;
    }
  });
  const env: ClipboardEnv = {
    clipboard: { write, writeText },
    fetchPng: async () => new Blob(["png"], { type: "image/png" }),
    makeItem: (data) => ({ data }),
    ...over,
  };
  return { env, write, writeText };
}

const dataUrl = async (b: Blob) => `data:${b.type};x`;

describe("buildCommentClipboardContent", () => {
  it("text only", () => {
    const c = build(doc(p("hello"), p("world")));
    expect(c.text).toBe("hello\nworld");
    expect(c.imageUrls).toEqual([]);
    expect(c.renderHtml((u) => u)).toBe("<p>hello</p><p>world</p>");
  });

  it("text + image keeps order and URL in text", () => {
    const c = build(doc(p("before"), img("a/1.webp"), p("after")));
    expect(c.imageUrls).toEqual([`${ORIGIN}/api/files/a/1.webp`]);
    expect(c.text).toBe(`before\n${ORIGIN}/api/files/a/1.webp\nafter`);
    const html = c.renderHtml((u) => `SRC(${u})`);
    expect(html.indexOf("before")).toBeLessThan(html.indexOf("<img"));
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("after"));
  });

  it("multiple images preserve order", () => {
    const c = build(doc(p("t1"), img("k1"), p("t2"), img("k2"), p("t3")));
    expect(c.imageUrls).toEqual([
      `${ORIGIN}/api/files/k1`,
      `${ORIGIN}/api/files/k2`,
    ]);
    const html = c.renderHtml((u) => u);
    const order = ["t1", "k1", "t2", "k2", "t3"].map((s) => html.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("image-only comment never has empty text", () => {
    expect(build(doc(img("only"))).text).toBe(`${ORIGIN}/api/files/only`);
  });

  it("skips images still uploading (no fileKey)", () => {
    const c = build(
      doc(p("x"), { type: "noteImage", attrs: { fileKey: null } })
    );
    expect(c.imageUrls).toEqual([]);
  });

  it("lists non-image attachments by name and URL", () => {
    const c = build(doc(p("see file")), [
      {
        id: "1",
        fileName: "spec.pdf",
        fileUrl: "k/spec.pdf",
        mimeType: "application/pdf",
        url: "/api/files/k/spec.pdf",
      },
    ]);
    expect(c.text).toContain("Attachment: spec.pdf");
    expect(c.text).toContain(`URL: ${ORIGIN}/api/files/k/spec.pdf`);
    expect(c.imageUrls).toEqual([]);
  });

  it("does not duplicate an attachment image already inline", () => {
    const c = build(doc(img("k/a.webp", "att1")), [
      {
        id: "att1",
        fileName: "a.webp",
        fileUrl: "k/a.webp",
        mimeType: "image/webp",
        url: "/api/files/k/a.webp",
      },
    ]);
    expect(c.imageUrls).toHaveLength(1);
  });

  it("escapes HTML and drops unsafe links", () => {
    const c = build(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "<script>alert(1)</script>" },
          {
            type: "text",
            text: "bad",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
        ],
      })
    );
    const html = c.renderHtml((u) => u);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
  });
});

describe("copyCommentToClipboard", () => {
  it("rich copy: html embeds converted PNG data URL", async () => {
    const { env, write } = makeEnv();
    const c = build(doc(p("hi"), img("k1")));
    expect(await copyCommentToClipboard(c, env, dataUrl)).toBe("rich");
    const data = (write.mock.calls[0][0][0] as Written).data;
    expect(await textOf(await data["text/html"])).toContain("data:image/png;x");
    expect(await textOf(await data["text/plain"])).toContain("/api/files/k1");
    expect(data["image/png"]).toBeUndefined(); // mixed content → no bare image
  });

  it("image-only comment also offers image/png", async () => {
    const { env, write } = makeEnv();
    await copyCommentToClipboard(build(doc(img("k1"))), env, dataUrl);
    const data = (write.mock.calls[0][0][0] as Written).data;
    expect(data["image/png"]).toBeDefined();
  });

  it("text-only comment still works", async () => {
    const { env } = makeEnv();
    expect(await copyCommentToClipboard(build(doc(p("plain"))), env)).toBe(
      "rich"
    );
  });

  it("image fetch failure degrades html to the URL, still rich", async () => {
    const { env, write } = makeEnv({
      fetchPng: async () => {
        throw new Error("403");
      },
    });
    const c = build(doc(p("hi"), img("k1")));
    expect(await copyCommentToClipboard(c, env, dataUrl)).toBe("rich");
    const data = (write.mock.calls[0][0][0] as Written).data;
    expect(await textOf(await data["text/html"])).toContain(
      `${ORIGIN}/api/files/k1`
    );
  });

  it("image-only + fetch failure falls back to text with URL", async () => {
    const { env, writeText } = makeEnv({
      fetchPng: async () => {
        throw new Error("403");
      },
    });
    expect(
      await copyCommentToClipboard(build(doc(img("k1"))), env, dataUrl)
    ).toBe("text");
    expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/api/files/k1`);
  });

  it("ClipboardItem unavailable → text", async () => {
    const { env, writeText } = makeEnv({ makeItem: undefined });
    expect(await copyCommentToClipboard(build(doc(p("a"))), env)).toBe("text");
    expect(writeText).toHaveBeenCalledWith("a");
  });

  it("clipboard.write unavailable → text", async () => {
    const writeText = vi.fn(async () => undefined);
    const { env } = makeEnv({ clipboard: { writeText } });
    expect(await copyCommentToClipboard(build(doc(p("a"))), env)).toBe("text");
    expect(writeText).toHaveBeenCalled();
  });

  it("unsupported mime type → text", async () => {
    const { env } = makeEnv({ supportsType: () => false });
    expect(await copyCommentToClipboard(build(doc(p("a"))), env)).toBe("text");
  });

  it("rich write failure → text fallback, no error", async () => {
    const writeText = vi.fn(async () => undefined);
    const { env } = makeEnv({
      clipboard: {
        write: async () => {
          throw new Error("NotAllowed");
        },
        writeText,
      },
    });
    expect(await copyCommentToClipboard(build(doc(p("a"))), env)).toBe("text");
    expect(writeText).toHaveBeenCalledWith("a");
  });

  it("throws only when text copy also fails", async () => {
    const { env } = makeEnv({
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    await expect(
      copyCommentToClipboard(build(doc(p("a"))), env)
    ).rejects.toThrow();
  });
});
