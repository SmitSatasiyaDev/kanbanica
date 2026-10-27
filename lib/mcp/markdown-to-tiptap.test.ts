import { describe, expect, it } from "vitest";
import { markdownToTiptap, type TiptapDoc } from "@/lib/mcp/markdown-to-tiptap";
import { tiptapToMarkdown } from "@/lib/mcp/tiptap-to-markdown";
import { validateTiptapDoc } from "@/lib/mcp/tiptap-validate";

function convert(markdown: string): TiptapDoc {
  const result = markdownToTiptap(markdown);
  if (!("doc" in result)) {
    throw new Error(result.error);
  }
  return result.doc;
}

describe("markdownToTiptap", () => {
  it("rejects empty input", () => {
    expect(markdownToTiptap("")).toEqual({ error: "Comment text is empty." });
    expect(markdownToTiptap("  \n\n ")).toEqual({
      error: "Comment text is empty.",
    });
  });

  it("converts the supported subset into valid nodes", () => {
    const doc = convert(
      [
        "# Title",
        "",
        "Some **bold**, *italic*, ~~strike~~ and `code` with a [link](https://example.com).",
        "",
        "> quoted",
        "",
        "- one",
        "- two",
        "",
        "3. three",
        "4. four",
        "",
        "```ts",
        "const a = 1;",
        "```",
        "",
        "---",
      ].join("\n")
    );
    const types = doc.content.map((n) => n.type);
    expect(types).toEqual([
      "heading",
      "paragraph",
      "blockquote",
      "bulletList",
      "orderedList",
      "codeBlock",
      "horizontalRule",
    ]);
    expect(doc.content[0].attrs).toEqual({ level: 1 });
    expect(doc.content[4].attrs).toEqual({ start: 3 });
    expect(doc.content[5].attrs).toEqual({ language: "ts" });
    expect(validateTiptapDoc(doc)).toEqual({ ok: true });

    const marks = (doc.content[1].content ?? []).flatMap(
      (n) => n.marks?.map((m) => m.type) ?? []
    );
    expect(marks).toEqual(["bold", "italic", "strike", "code", "link"]);
  });

  it("keeps a safe link and drops an unsafe one", () => {
    const safe = convert("[ok](https://example.com) and [mail](mailto:a@b.co)");
    const hrefs = (safe.content[0].content ?? [])
      .flatMap((n) => n.marks ?? [])
      .map((m) => m.attrs?.href);
    expect(hrefs).toEqual(["https://example.com", "mailto:a@b.co"]);

    const unsafe = convert("[bad](javascript:alert(1)) text");
    const json = JSON.stringify(unsafe);
    expect(json).not.toContain('"link"');
    expect(json).toContain("bad");
    expect(validateTiptapDoc(unsafe)).toEqual({ ok: true });
  });

  it("keeps tables as plain text", () => {
    const doc = convert("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(doc.content.every((n) => n.type === "paragraph")).toBe(true);
    expect(JSON.stringify(doc)).toContain("| a | b |");
    expect(validateTiptapDoc(doc)).toEqual({ ok: true });
  });

  it("keeps raw HTML and images by URL as text", () => {
    const html = convert("<script>alert(1)</script> and <b>x</b>");
    expect(JSON.stringify(html)).toContain("<script>");
    expect(html.content.every((n) => n.type === "paragraph")).toBe(true);

    const image = convert("![cat](https://example.com/cat.png)");
    expect(JSON.stringify(image)).not.toContain("noteImage");
    expect(JSON.stringify(image)).toContain(
      "![cat](https://example.com/cat.png)"
    );
    expect(validateTiptapDoc(html)).toEqual({ ok: true });
    expect(validateTiptapDoc(image)).toEqual({ ok: true });
  });

  it("handles nested lists and empty items", () => {
    const doc = convert("- a\n  - b\n-\n- c");
    expect(validateTiptapDoc(doc)).toEqual({ ok: true });
  });

  it("round trips the supported subset", () => {
    const source = [
      "## Heading",
      "",
      "Plain with **bold**, *italic*, ~~gone~~, `code` and [a link](https://example.com).",
      "",
      "> a quote",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "```js",
      "let x = 1;",
      "```",
      "",
      "---",
    ].join("\n");
    const once = tiptapToMarkdown(convert(source));
    expect(once).toBe(source);
    expect(tiptapToMarkdown(convert(once))).toBe(once);
  });
});
