import { describe, expect, it } from "vitest";
import {
  type AttachmentTarget,
  type ConvertOptions,
  type MentionTarget,
  markdownToTiptap,
  scanMarkdownRefs,
  type TiptapDoc,
  type TiptapNode,
} from "@/lib/mcp/markdown-to-tiptap";
import { tiptapToMarkdown } from "@/lib/mcp/tiptap-to-markdown";
import { validateTiptapDoc } from "@/lib/mcp/tiptap-validate";
import { extractInlineAttachmentIds, extractMentionIds } from "@/lib/notes";

const dana: MentionTarget = { id: "user_dana", name: "Dana Lee" };
const mentions = new Map([[dana.id, dana]]);

const image: AttachmentTarget = {
  id: "att_img",
  fileKey: "attachments/w1/t1/att_img/shot.png",
  fileName: "shot.png",
  mimeType: "image/png",
  size: 100,
};
const pdf: AttachmentTarget = {
  id: "att_pdf",
  fileKey: "attachments/w1/t1/att_pdf/spec.pdf",
  fileName: "spec.pdf",
  mimeType: "application/pdf",
  size: 2000,
};
const attachments = new Map([
  [image.id, image],
  [pdf.id, pdf],
]);

function describe_(markdown: string, opts: ConvertOptions = {}): TiptapDoc {
  const result = markdownToTiptap(markdown, { mode: "description", ...opts });
  if (!("doc" in result)) {
    throw new Error(result.error);
  }
  return result.doc;
}

function comment(markdown: string, opts: ConvertOptions = {}): TiptapDoc {
  const result = markdownToTiptap(markdown, opts);
  if (!("doc" in result)) {
    throw new Error(result.error);
  }
  return result.doc;
}

const types = (nodes: TiptapNode[] | undefined) =>
  (nodes ?? []).map((n) => n.type);

describe("mentions", () => {
  it("turns <@id> into a mention node for an allowed user", () => {
    const doc = comment("hi <@user_dana> there", { mentions });
    const inline = doc.content[0].content ?? [];
    expect(types(inline)).toEqual(["text", "mention", "text"]);
    expect(inline[1]).toEqual({
      type: "mention",
      attrs: { id: "user_dana", label: "Dana Lee", mentionSuggestionChar: "@" },
    });
    expect(validateTiptapDoc(doc).ok).toBe(true);
    expect(extractMentionIds(doc)).toEqual(["user_dana"]);
  });

  it("uses the stored name, not the one written in <@id|Name>", () => {
    const doc = comment("<@user_dana|Someone Else>", { mentions });
    expect(doc.content[0].content?.[0].attrs?.label).toBe("Dana Lee");
  });

  it("leaves a user who is not allowed as plain text, so nobody outside is notified", () => {
    const doc = comment("ping <@stranger|Olga> and <@other>", { mentions });
    const text = (doc.content[0].content ?? []).map((n) => n.text).join("");
    expect(text).toBe("ping @Olga and <@other>");
    expect(extractMentionIds(doc)).toEqual([]);
  });

  it("without a mentions map nothing becomes a mention", () => {
    const doc = comment("<@user_dana>");
    expect(extractMentionIds(doc)).toEqual([]);
  });

  it("a bare @name is plain text", () => {
    const doc = comment("hello @Dana", { mentions });
    expect(extractMentionIds(doc)).toEqual([]);
  });

  it("does not look inside code", () => {
    const doc = comment("`<@user_dana>`\n\n```\n<@user_dana>\n```", {
      mentions,
    });
    expect(extractMentionIds(doc)).toEqual([]);
  });

  it("works inside bold text and list items", () => {
    const doc = comment("- **hi** <@user_dana>", { mentions });
    expect(extractMentionIds(doc)).toEqual(["user_dana"]);
    expect(validateTiptapDoc(doc).ok).toBe(true);
  });

  it("caps the number of mentions in one text", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `u${i}`);
    const map = new Map(ids.map((id) => [id, { id, name: id }]));
    const doc = comment(ids.map((id) => `<@${id}>`).join(" "), {
      mentions: map,
    });
    expect(extractMentionIds(doc)).toHaveLength(20);
  });

  it("scanMarkdownRefs lists mention ids outside code", () => {
    expect(
      scanMarkdownRefs("a <@u1> b <@u2|Bo> `<@u3>`\n\n```\n<@u4>\n```")
        .mentionIds
    ).toEqual(["u1", "u2"]);
  });
});

describe("description mode", () => {
  it("turns - [ ] and - [x] into a task list", () => {
    const doc = describe_("- [ ] one\n- [x] two **bold**");
    expect(doc.content[0].type).toBe("taskList");
    const items = doc.content[0].content ?? [];
    expect(items.map((i) => i.attrs)).toEqual([
      { checked: false },
      { checked: true },
    ]);
    expect(items[0].content?.[0].content?.[0].text).toBe("one");
    expect(validateTiptapDoc(doc, { mode: "description" }).ok).toBe(true);
  });

  it("keeps a mixed list as bullets", () => {
    const doc = describe_("- [ ] one\n- two");
    expect(doc.content[0].type).toBe("bulletList");
  });

  it("converts nested checklists", () => {
    const doc = describe_("- [ ] parent\n  - [x] child");
    const parent = doc.content[0].content?.[0];
    expect(parent?.content?.map((n) => n.type)).toEqual([
      "paragraph",
      "taskList",
    ]);
    expect(validateTiptapDoc(doc, { mode: "description" }).ok).toBe(true);
  });

  it("comment mode never produces task lists or files", () => {
    const doc = comment("- [ ] one\n\n[spec](attachment:att_pdf)", {
      attachments,
    });
    expect(JSON.stringify(doc)).not.toContain("taskList");
    expect(JSON.stringify(doc)).not.toContain("noteFile");
    expect(validateTiptapDoc(doc).ok).toBe(true);
  });

  it("an empty description gives an empty document that validates", () => {
    const doc = describe_("");
    expect(doc).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(validateTiptapDoc(doc, { mode: "description" }).ok).toBe(true);
  });

  it("the comment validator still refuses description-only nodes", () => {
    const doc = describe_("- [ ] one");
    expect(validateTiptapDoc(doc).ok).toBe(false);
  });
});

describe("attachments", () => {
  it("turns an image of the same task into a noteImage with the stored key", () => {
    const doc = describe_(
      "before\n\n![the shot](attachment:att_img)\n\nafter",
      {
        attachments,
      }
    );
    expect(types(doc.content)).toEqual(["paragraph", "noteImage", "paragraph"]);
    expect(doc.content[1]).toEqual({
      type: "noteImage",
      attrs: {
        fileKey: image.fileKey,
        attachmentId: "att_img",
        alt: "the shot",
      },
    });
    expect(validateTiptapDoc(doc, { mode: "description" }).ok).toBe(true);
  });

  it("turns a link into a noteFile with the stored name, size and type", () => {
    const doc = describe_("[whatever label](attachment:att_pdf)", {
      attachments,
    });
    expect(doc.content[0]).toEqual({
      type: "noteFile",
      attrs: {
        fileKey: pdf.fileKey,
        attachmentId: "att_pdf",
        fileName: "spec.pdf",
        fileSize: 2000,
        mimeType: "application/pdf",
      },
    });
  });

  it("splits a paragraph around an inline image, in order", () => {
    const doc = describe_("one ![a](attachment:att_img) two", { attachments });
    expect(types(doc.content)).toEqual(["paragraph", "noteImage", "paragraph"]);
    expect(doc.content[0].content?.[0].text).toBe("one ");
    expect(doc.content[2].content?.[0].text).toBe(" two");
  });

  it("keeps images inside list items and quotes valid", () => {
    const doc = describe_(
      "- item\n  ![a](attachment:att_img)\n\n> ![b](attachment:att_img)",
      {
        attachments,
      }
    );
    expect(validateTiptapDoc(doc, { mode: "description" }).ok).toBe(true);
    expect(extractInlineAttachmentIds(doc)).toEqual(["att_img"]);
  });

  it("a list item that starts with an image still starts with a paragraph", () => {
    const doc = describe_("- ![a](attachment:att_img)", { attachments });
    const item = doc.content[0].content?.[0];
    expect(item?.content?.[0].type).toBe("paragraph");
    expect(validateTiptapDoc(doc, { mode: "description" }).ok).toBe(true);
  });

  it("drops an id that is not an attachment of this task to plain text", () => {
    const doc = describe_(
      "![secret](attachment:other_task_att) and [a file](attachment:nope)",
      {
        attachments,
      }
    );
    expect(extractInlineAttachmentIds(doc)).toEqual([]);
    expect(JSON.stringify(doc)).not.toContain("noteImage");
    expect(JSON.stringify(doc)).not.toContain("noteFile");
    const text = JSON.stringify(doc);
    expect(text).toContain("secret");
    expect(text).toContain("a file");
  });

  it("never uses a storage key written by the author", () => {
    const doc = describe_("![x](attachment:att_img)", {
      attachments: new Map([
        ["att_img", { ...image, fileKey: "real/key.png" }],
      ]),
    });
    expect(doc.content[0].attrs?.fileKey).toBe("real/key.png");
  });

  it("scanMarkdownRefs lists attachment ids from images and links", () => {
    expect(
      scanMarkdownRefs(
        "![a](attachment:a1) [b](attachment:b2) [c](https://x.io)"
      ).attachmentIds
    ).toEqual(["a1", "b2"]);
  });

  it("an image of an unsupported kind written as an image becomes a file chip", () => {
    const doc = describe_("![spec](attachment:att_pdf)", { attachments });
    expect(doc.content[0].type).toBe("noteFile");
  });
});

describe("round trip: get_task Markdown written back by update_task", () => {
  // A description as the web editor stores it: mentions, an image, a file, a
  // checklist, a quote with an image inside, and plain formatting.
  const stored = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ping " },
          {
            type: "mention",
            attrs: {
              id: "user_dana",
              label: "Dana Lee",
              mentionSuggestionChar: "@",
            },
          },
          { type: "text", text: " about " },
          { type: "text", text: "the bug", marks: [{ type: "bold" }] },
        ],
      },
      {
        type: "noteImage",
        attrs: {
          fileKey: image.fileKey,
          attachmentId: "att_img",
          alt: "shot [1]",
        },
      },
      {
        type: "noteFile",
        attrs: {
          fileKey: pdf.fileKey,
          attachmentId: "att_pdf",
          fileName: "spec.pdf",
          fileSize: 2000,
          mimeType: "application/pdf",
        },
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "done" }] },
            ],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "todo with " },
                  { type: "mention", attrs: { id: "user_eli", label: "Eli" } },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "blockquote",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "quoted" }] },
          {
            type: "noteImage",
            attrs: {
              fileKey: image.fileKey,
              attachmentId: "att_img2",
              alt: "inner",
            },
          },
        ],
      },
    ],
  };
  const image2: AttachmentTarget = { ...image, id: "att_img2" };

  it("keeps the same attachment ids and mention ids", () => {
    const markdown = tiptapToMarkdown(stored);
    expect(markdown).toContain("<@user_dana|Dana Lee>");
    expect(markdown).toContain("![shot \\[1\\]](attachment:att_img)");
    expect(markdown).toContain("[spec.pdf](attachment:att_pdf)");
    expect(markdown).toContain("- [x] done");

    // What the tool does: scan, look up (everything is still allowed), convert.
    const refs = scanMarkdownRefs(markdown);
    expect(refs.mentionIds.sort()).toEqual(["user_dana", "user_eli"]);
    expect(refs.attachmentIds.sort()).toEqual([
      "att_img",
      "att_img2",
      "att_pdf",
    ]);
    const result = markdownToTiptap(markdown, {
      mode: "description",
      mentions: new Map([
        ["user_dana", dana],
        ["user_eli", { id: "user_eli", name: "Eli" }],
      ]),
      attachments: new Map([
        [image.id, image],
        [pdf.id, pdf],
        [image2.id, image2],
      ]),
    });
    if (!("doc" in result)) {
      throw new Error(result.error);
    }
    expect(validateTiptapDoc(result.doc, { mode: "description" }).ok).toBe(
      true
    );
    expect(extractInlineAttachmentIds(result.doc).sort()).toEqual(
      extractInlineAttachmentIds(stored).sort()
    );
    expect(extractMentionIds(result.doc).sort()).toEqual(
      extractMentionIds(stored).sort()
    );
    // The Markdown of the result equals the Markdown that went in.
    expect(tiptapToMarkdown(result.doc)).toBe(markdown);
  });

  it("a mention of someone who lost access is not carried over", () => {
    const markdown = tiptapToMarkdown(stored);
    const result = markdownToTiptap(markdown, {
      mode: "description",
      mentions: new Map([["user_dana", dana]]),
      attachments: new Map([
        [image.id, image],
        [pdf.id, pdf],
        [image2.id, image2],
      ]),
    });
    if (!("doc" in result)) {
      throw new Error(result.error);
    }
    expect(extractMentionIds(result.doc)).toEqual(["user_dana"]);
  });
});
