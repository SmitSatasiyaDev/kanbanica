import { describe, expect, it } from "vitest";
import { MAX_DOC_DEPTH, validateTiptapDoc } from "@/lib/mcp/tiptap-validate";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});

describe("validateTiptapDoc", () => {
  it("accepts a document using the whole allowlist", () => {
    const result = validateTiptapDoc(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [t("Title")] },
        p(
          t("bold", [{ type: "bold" }]),
          { type: "hardBreak" },
          t("link", [{ type: "link", attrs: { href: "https://example.com" } }])
        ),
        { type: "blockquote", content: [p(t("quote"))] },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [{ type: "listItem", content: [p(t("one"))] }],
        },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [p(t("a"))] }],
        },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [t("const a = 1;")],
        },
        { type: "horizontalRule" },
        {
          type: "noteImage",
          attrs: {
            fileKey: "attachments/a/b/c/image-1.png",
            attachmentId: "c",
            alt: "x",
          },
        }
      )
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects an unknown node", () => {
    const result = validateTiptapDoc(doc({ type: "table", content: [] }));
    expect(result.ok).toBe(false);
  });

  it("rejects nodes the comment editor cannot render", () => {
    expect(
      validateTiptapDoc(doc({ type: "noteFile", attrs: { fileName: "a" } })).ok
    ).toBe(false);
    expect(validateTiptapDoc(doc({ type: "taskList", content: [] })).ok).toBe(
      false
    );
  });

  it("rejects an unknown attribute", () => {
    expect(
      validateTiptapDoc(
        doc({
          type: "heading",
          attrs: { level: 1, style: "x" },
          content: [t("a")],
        })
      ).ok
    ).toBe(false);
    expect(
      validateTiptapDoc(
        doc({ type: "noteImage", attrs: { fileKey: "k", src: "http://x" } })
      ).ok
    ).toBe(false);
    expect(
      validateTiptapDoc(
        doc({ type: "paragraph", attrs: { textAlign: "left" } })
      ).ok
    ).toBe(false);
  });

  it("rejects an out-of-range attribute value", () => {
    expect(
      validateTiptapDoc(
        doc({ type: "heading", attrs: { level: 9 }, content: [t("a")] })
      ).ok
    ).toBe(false);
  });

  it("rejects an unknown mark", () => {
    expect(validateTiptapDoc(doc(p(t("a", [{ type: "highlight" }])))).ok).toBe(
      false
    );
  });

  it("rejects an unsafe link", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "/relative",
    ]) {
      expect(
        validateTiptapDoc(doc(p(t("a", [{ type: "link", attrs: { href } }]))))
          .ok
      ).toBe(false);
    }
    expect(
      validateTiptapDoc(
        doc(p(t("a", [{ type: "link", attrs: { href: "mailto:a@b.co" } }])))
      ).ok
    ).toBe(true);
  });

  it("rejects extra attributes on a link", () => {
    expect(
      validateTiptapDoc(
        doc(
          p(
            t("a", [
              {
                type: "link",
                attrs: { href: "https://x.io", target: "_blank" },
              },
            ])
          )
        )
      ).ok
    ).toBe(false);
  });

  it("rejects a document that is too deep", () => {
    let inner: unknown = p(t("deep"));
    for (let i = 0; i < MAX_DOC_DEPTH + 2; i++) {
      inner = { type: "blockquote", content: [inner] };
    }
    expect(validateTiptapDoc(doc(inner)).ok).toBe(false);
  });

  it("rejects a document that is too large", () => {
    expect(validateTiptapDoc(doc(p(t("x".repeat(250_000))))).ok).toBe(false);
  });

  it("rejects a bad root and structural mistakes", () => {
    expect(validateTiptapDoc(null).ok).toBe(false);
    expect(validateTiptapDoc({ type: "paragraph" }).ok).toBe(false);
    expect(validateTiptapDoc(doc(t("loose text"))).ok).toBe(false);
    expect(validateTiptapDoc(doc(p({ type: "text", text: "" }))).ok).toBe(
      false
    );
    expect(
      validateTiptapDoc(doc({ type: "horizontalRule", content: [p()] })).ok
    ).toBe(false);
  });
});

describe("mention nodes", () => {
  const mention = (attrs: Record<string, unknown>) => ({
    type: "mention",
    attrs,
  });

  it("accepts a mention with id, label and mentionSuggestionChar, in both modes", () => {
    const body = doc(
      p(
        t("hi "),
        mention({ id: "u1", label: "Dana", mentionSuggestionChar: "@" })
      )
    );
    expect(validateTiptapDoc(body).ok).toBe(true);
    expect(validateTiptapDoc(body, { mode: "description" }).ok).toBe(true);
  });

  it("rejects unknown attributes and wrong types on a mention", () => {
    expect(validateTiptapDoc(doc(p(mention({ id: "u1", href: "x" })))).ok).toBe(
      false
    );
    expect(validateTiptapDoc(doc(p(mention({ id: 5 })))).ok).toBe(false);
  });

  it("does not allow a mention outside inline text", () => {
    expect(validateTiptapDoc(doc(mention({ id: "u1" }))).ok).toBe(false);
  });
});

describe("description mode", () => {
  const taskList = (checked: unknown) => ({
    type: "taskList",
    content: [
      { type: "taskItem", attrs: { checked }, content: [p(t("do it"))] },
    ],
  });
  const noteFile = {
    type: "noteFile",
    attrs: {
      fileKey: "attachments/w/t/a/spec.pdf",
      attachmentId: "a",
      fileName: "spec.pdf",
      fileSize: 10,
      mimeType: "application/pdf",
    },
  };

  it("allows task lists and file chips that comments refuse", () => {
    for (const body of [doc(taskList(true)), doc(noteFile)]) {
      expect(validateTiptapDoc(body, { mode: "description" }).ok).toBe(true);
      expect(validateTiptapDoc(body).ok).toBe(false);
    }
  });

  it("checks the task item's checked flag", () => {
    expect(
      validateTiptapDoc(doc(taskList("yes")), { mode: "description" }).ok
    ).toBe(false);
  });

  it("allows images and files inside quotes and list items only in description mode", () => {
    const image = {
      type: "noteImage",
      attrs: { fileKey: "k", attachmentId: "a", alt: "x" },
    };
    const quote = doc({ type: "blockquote", content: [p(t("q")), image] });
    expect(validateTiptapDoc(quote, { mode: "description" }).ok).toBe(true);
    expect(validateTiptapDoc(quote).ok).toBe(false);
    const item = doc({
      type: "bulletList",
      content: [{ type: "listItem", content: [p(t("a")), noteFile] }],
    });
    expect(validateTiptapDoc(item, { mode: "description" }).ok).toBe(true);
  });

  it("rejects bad file chip attributes", () => {
    const bad = doc({
      type: "noteFile",
      attrs: { ...noteFile.attrs, fileSize: -1 },
    });
    expect(validateTiptapDoc(bad, { mode: "description" }).ok).toBe(false);
    const extra = doc({
      type: "noteFile",
      attrs: { ...noteFile.attrs, url: "http://x" },
    });
    expect(validateTiptapDoc(extra, { mode: "description" }).ok).toBe(false);
  });
});
