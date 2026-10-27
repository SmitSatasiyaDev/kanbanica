import { describe, expect, it } from "vitest";
import { tiptapToMarkdown } from "@/lib/mcp/tiptap-to-markdown";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});

describe("tiptapToMarkdown", () => {
  it("returns an empty string for empty or unreadable bodies", () => {
    expect(tiptapToMarkdown(null)).toBe("");
    expect(tiptapToMarkdown("not json")).toBe("");
    expect(tiptapToMarkdown(doc())).toBe("");
  });

  it("reads a description stored as a JSON string", () => {
    const body = JSON.stringify(
      doc(p(t("Hello ", [{ type: "bold" }]), t("world")))
    );
    expect(tiptapToMarkdown(body)).toBe("**Hello** world");
  });

  it("writes task lists as checkboxes", () => {
    const body = doc({
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [p(t("done"))] },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [p(t("todo"))],
        },
      ],
    });
    expect(tiptapToMarkdown(body)).toBe("- [x] done\n- [ ] todo");
  });

  it("turns images and files into attachment links", () => {
    const body = doc(
      p(t("see below")),
      {
        type: "noteImage",
        attrs: {
          fileKey: "attachments/w/t/a1/image-1.png",
          attachmentId: "a1",
          alt: "shot",
        },
      },
      {
        type: "noteFile",
        attrs: { fileKey: "k", attachmentId: "f1", fileName: "spec [v2].pdf" },
      }
    );
    const md = tiptapToMarkdown(body);
    expect(md).toContain("![shot](attachment:a1)");
    expect(md).toContain("[spec \\[v2\\].pdf](attachment:f1)");
    expect(md).not.toContain("/api/files");
    expect(md).not.toContain("attachments/w/t");
  });

  it("writes mentions as <@userId|Name>", () => {
    const body = doc(
      p(t("hi "), { type: "mention", attrs: { id: "u1", label: "Dana" } })
    );
    expect(tiptapToMarkdown(body)).toBe("hi <@u1|Dana>");
  });

  it("cleans mention labels and falls back to @Name for odd ids", () => {
    const body = doc(
      p({
        type: "mention",
        attrs: { id: "u1", label: "Da>na | <x>\nQ" },
      }),
      p({ type: "mention", attrs: { id: "bad id!", label: "Eve" } })
    );
    const out = tiptapToMarkdown(body);
    expect(out).toContain("<@u1|Da na    x  Q>");
    expect(out).toContain("@Eve");
  });

  it("ignores textAlign and unknown marks, and degrades unknown nodes to text", () => {
    const body = doc(
      {
        type: "paragraph",
        attrs: { textAlign: "center" },
        content: [t("centered", [{ type: "highlight" }])],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [p(t("A"))] },
              { type: "tableCell", content: [p(t("B"))] },
            ],
          },
        ],
      }
    );
    const md = tiptapToMarkdown(body);
    expect(md).toContain("centered");
    expect(md).toContain("A");
    expect(md).toContain("B");
  });

  it("drops an unsafe link target but keeps the text", () => {
    const body = doc(
      p(t("click", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))
    );
    expect(tiptapToMarkdown(body)).toBe("click");
  });

  it("indents nested lists and keeps code blocks intact", () => {
    const body = doc(
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p(t("outer")),
              {
                type: "bulletList",
                content: [{ type: "listItem", content: [p(t("inner"))] }],
              },
            ],
          },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: null },
        content: [t("a\n```\nb")],
      }
    );
    const md = tiptapToMarkdown(body);
    expect(md).toContain("- outer\n\n  - inner");
    expect(md).toContain("````\na\n```\nb\n````");
  });

  it("keeps spaces outside the emphasis markers", () => {
    const body = doc(p(t("a "), t(" bold ", [{ type: "bold" }]), t("b")));
    expect(tiptapToMarkdown(body)).toBe("a  **bold** b");
  });
});
