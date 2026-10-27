import MarkdownIt, { type Token } from "markdown-it";
import { type DocMode, SAFE_LINK } from "@/lib/mcp/tiptap-validate";

// Markdown to the Tiptap JSON the editors can render. Only markdown-it's token
// stream is used; every token is mapped by hand to a node or mark the editor
// registers (StarterKit + Link). Anything else (tables, raw HTML, images by
// URL) is kept as plain text, so nothing the editor cannot show is ever
// produced.
//
// Two modes. "comment" (the default) emits what the comment editor renders.
// "description" also emits task lists (`- [ ]` / `- [x]`) and, for attachments
// of the same task, image and file nodes (`![alt](attachment:<id>)` and
// `[name](attachment:<id>)`).
//
// The converter is pure. Everything that needs the database is passed in:
// `mentions` holds the users a `<@userId>` may become a mention for (the caller
// has checked they are active members who can see the task's project), and
// `attachments` holds the task's inline attachments. Anything not in those
// maps stays plain text, so nobody outside the task is ever mentioned.

export type TiptapMark = { type: string; attrs?: Record<string, unknown> };
export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
};
export type TiptapDoc = TiptapNode & { type: "doc"; content: TiptapNode[] };

export type MarkdownResult = { ok: true; doc: TiptapDoc } | { error: string };

export type MentionTarget = { id: string; name: string };
export type AttachmentTarget = {
  id: string;
  // Storage key of the file, taken from the database and never from the text.
  fileKey: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type ConvertOptions = {
  mode?: DocMode;
  mentions?: ReadonlyMap<string, MentionTarget>;
  attachments?: ReadonlyMap<string, AttachmentTarget>;
};

// `<@userId>` or `<@userId|Name>`. The name part is what get_task writes; it
// is ignored on the way in (the stored name comes from the database).
const MENTION_PATTERN = /<@([A-Za-z0-9_-]{1,64})(?:\|([^<>\n]{0,100}))?>/g;
const ATTACHMENT_PREFIX = "attachment:";
const MAX_MENTIONS_PER_TEXT = 20;

// "commonmark" has no tables, so a table stays as text. Strikethrough is turned
// back on because the editor supports it. `html: false` keeps raw HTML as text.
const md = new MarkdownIt("commonmark", { html: false, linkify: false });
md.enable("strikethrough");

function pushText(target: TiptapNode, text: string, marks: TiptapMark[]) {
  if (!text) {
    return;
  }
  const node: TiptapNode = { type: "text", text };
  if (marks.length > 0) {
    node.marks = marks.map((m) => ({ ...m }));
  }
  target.content = target.content ?? [];
  target.content.push(node);
}

// The alt text of an image token as plain text. `token.content` still holds the
// raw label with its backslash escapes, so the parsed children are used.
function imageAlt(token: Token): string {
  const parts = (token.children ?? []).filter(
    (c) =>
      c.type === "text" || c.type === "code_inline" || c.type === "text_special"
  );
  return parts.length > 0
    ? parts.map((c) => c.content).join("")
    : token.content;
}

function attachmentIdOf(url: string): string | null {
  if (!url.startsWith(ATTACHMENT_PREFIX)) {
    return null;
  }
  const id = url.slice(ATTACHMENT_PREFIX.length);
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null;
}

// The node for an allowed attachment. An image written as an image becomes an
// image node; everything else becomes a file chip. The key and file name come
// from the database row.
function attachmentNode(
  att: AttachmentTarget,
  asImage: boolean,
  alt: string
): TiptapNode {
  if (asImage && att.mimeType.startsWith("image/")) {
    return {
      type: "noteImage",
      attrs: {
        fileKey: att.fileKey,
        attachmentId: att.id,
        alt: (alt || att.fileName).slice(0, 500),
      },
    };
  }
  return {
    type: "noteFile",
    attrs: {
      fileKey: att.fileKey,
      attachmentId: att.id,
      fileName: att.fileName.slice(0, 500),
      fileSize: att.size,
      mimeType: att.mimeType.slice(0, 500),
    },
  };
}

// Text with `<@userId>` turned into mention nodes where the user is allowed.
function pushTextWithMentions(
  target: TiptapNode,
  text: string,
  marks: TiptapMark[],
  opts: ConvertOptions,
  counter: { mentions: number }
) {
  let last = 0;
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const start = match.index ?? 0;
    pushText(target, text.slice(last, start), marks);
    last = start + match[0].length;

    const allowed =
      counter.mentions < MAX_MENTIONS_PER_TEXT
        ? opts.mentions?.get(match[1])
        : undefined;
    if (allowed) {
      counter.mentions += 1;
      target.content = target.content ?? [];
      target.content.push({
        type: "mention",
        attrs: {
          id: allowed.id,
          label: allowed.name.slice(0, 200),
          mentionSuggestionChar: "@",
        },
      });
    } else {
      // Not allowed: nobody is mentioned. Keep a readable form of the text.
      pushText(target, match[2] ? `@${match[2].trim()}` : match[0], marks);
    }
  }
  pushText(target, text.slice(last), marks);
}

function addInline(
  target: TiptapNode,
  children: Token[] | null,
  opts: ConvertOptions,
  counter: { mentions: number }
) {
  const description = opts.mode === "description";
  // Active marks. Links are tracked separately so an unsafe href leaves the
  // text without a link instead of dropping it.
  const marks: TiptapMark[] = [];
  const linkStack: (TiptapMark | null)[] = [];
  // While inside `[name](attachment:<id>)` the label is collected, not written:
  // the whole link becomes one file node (or plain text if it is not allowed).
  let fileLink: { id: string; label: string } | null = null;

  for (const token of children ?? []) {
    if (fileLink && token.type !== "link_close") {
      if (
        token.type === "text" ||
        token.type === "code_inline" ||
        token.type === "text_special"
      ) {
        fileLink.label += token.content;
      }
      continue;
    }
    switch (token.type) {
      case "text":
        pushTextWithMentions(target, token.content, marks, opts, counter);
        break;
      case "code_inline":
        pushText(target, token.content, [...marks, { type: "code" }]);
        break;
      case "softbreak":
      case "hardbreak":
        // Line breaks are kept as the author wrote them.
        target.content = target.content ?? [];
        target.content.push({ type: "hardBreak" });
        break;
      case "strong_open":
        marks.push({ type: "bold" });
        break;
      case "em_open":
        marks.push({ type: "italic" });
        break;
      case "s_open":
        marks.push({ type: "strike" });
        break;
      case "strong_close":
      case "em_close":
      case "s_close":
        marks.pop();
        break;
      case "link_open": {
        const href = String(token.attrGet("href") ?? "");
        const fileId = description ? attachmentIdOf(href) : null;
        if (fileId) {
          fileLink = { id: fileId, label: "" };
          linkStack.push(null);
        } else if (SAFE_LINK.test(href)) {
          const mark: TiptapMark = { type: "link", attrs: { href } };
          marks.push(mark);
          linkStack.push(mark);
        } else {
          linkStack.push(null);
        }
        break;
      }
      case "link_close": {
        const mark = linkStack.pop();
        if (fileLink) {
          const att = opts.attachments?.get(fileLink.id);
          if (att) {
            target.content = target.content ?? [];
            target.content.push(attachmentNode(att, false, fileLink.label));
          } else {
            // Unknown or foreign id: keep only the label, as plain text.
            pushText(target, fileLink.label, marks);
          }
          fileLink = null;
          break;
        }
        if (mark) {
          const index = marks.lastIndexOf(mark);
          if (index !== -1) {
            marks.splice(index, 1);
          }
        }
        break;
      }
      case "image": {
        const src = String(token.attrGet("src") ?? "");
        const imageId = description ? attachmentIdOf(src) : null;
        if (imageId) {
          const att = opts.attachments?.get(imageId);
          if (att) {
            target.content = target.content ?? [];
            target.content.push(attachmentNode(att, true, imageAlt(token)));
          } else {
            pushText(target, imageAlt(token), marks);
          }
          break;
        }
        // Images by URL are not supported: keep what the author wrote as text.
        pushText(target, `![${token.content}](${src})`, marks);
        break;
      }
      default:
        pushText(target, token.content, marks);
    }
  }
}

function codeText(content: string): string {
  return content.endsWith("\n") ? content.slice(0, -1) : content;
}

// Builds the document from the block tokens with a stack of open containers.
function buildDoc(
  tokens: Token[],
  opts: ConvertOptions,
  counter: { mentions: number }
): TiptapDoc {
  const doc: TiptapDoc = { type: "doc", content: [] };
  const stack: TiptapNode[] = [doc];
  const top = () => stack[stack.length - 1];
  const append = (node: TiptapNode) => {
    const parent = top();
    parent.content = parent.content ?? [];
    parent.content.push(node);
  };
  const open = (node: TiptapNode) => {
    append(node);
    stack.push(node);
  };
  const close = () => {
    stack.pop();
  };

  for (const token of tokens) {
    switch (token.type) {
      case "paragraph_open":
        open({ type: "paragraph" });
        break;
      case "heading_open":
        open({
          type: "heading",
          attrs: {
            level: Math.min(Math.max(Number(token.tag.slice(1)), 1), 6),
          },
        });
        break;
      case "blockquote_open":
        open({ type: "blockquote" });
        break;
      case "bullet_list_open":
        open({ type: "bulletList" });
        break;
      case "ordered_list_open": {
        const start = Number.parseInt(
          String(token.attrGet("start") ?? "1"),
          10
        );
        open({
          type: "orderedList",
          attrs: { start: Number.isFinite(start) && start > 0 ? start : 1 },
        });
        break;
      }
      case "list_item_open":
        open({ type: "listItem" });
        break;
      case "paragraph_close":
      case "heading_close":
      case "blockquote_close":
      case "bullet_list_close":
      case "ordered_list_close":
        close();
        break;
      case "list_item_close": {
        // An item must start with a paragraph, even an empty one.
        const item = top();
        if (!item.content || item.content.length === 0) {
          item.content = [{ type: "paragraph" }];
        }
        close();
        break;
      }
      case "inline":
        addInline(top(), token.children, opts, counter);
        break;
      case "fence":
      case "code_block": {
        const language =
          token.type === "fence" ? token.info.trim().split(/\s+/)[0] : "";
        const block: TiptapNode = {
          type: "codeBlock",
          attrs: { language: language || null },
        };
        pushText(block, codeText(token.content), []);
        append(block);
        break;
      }
      case "hr":
        append({ type: "horizontalRule" });
        break;
      default: {
        // A block we do not map: keep its text.
        const text = token.content.trim();
        if (text) {
          const paragraph: TiptapNode = { type: "paragraph" };
          pushText(paragraph, text, []);
          append(paragraph);
        }
      }
    }
  }
  return doc;
}

const ATTACHMENT_NODES = new Set(["noteImage", "noteFile"]);

function isBlankInline(nodes: TiptapNode[]): boolean {
  return nodes.every(
    (n) =>
      n.type === "hardBreak" ||
      (n.type === "text" && (n.text ?? "").trim() === "")
  );
}

// Image and file nodes are blocks, but Markdown writes them inline. They were
// collected inside paragraphs and headings; here each one is lifted out and the
// text around it is split into separate paragraphs, in order. List items and
// task items must start with a paragraph, so one is added when needed.
function liftAttachments(container: TiptapNode) {
  if (!container.content) {
    return;
  }
  const out: TiptapNode[] = [];
  for (const child of container.content) {
    liftAttachments(child);
    const holdsAttachment =
      (child.type === "paragraph" || child.type === "heading") &&
      child.content?.some((c) => ATTACHMENT_NODES.has(c.type));
    if (!(holdsAttachment && child.content)) {
      out.push(child);
      continue;
    }
    let run: TiptapNode[] = [];
    const flush = () => {
      if (run.length > 0 && !isBlankInline(run)) {
        out.push({ ...child, content: run });
      }
      run = [];
    };
    for (const part of child.content) {
      if (ATTACHMENT_NODES.has(part.type)) {
        flush();
        out.push(part);
      } else {
        run.push(part);
      }
    }
    flush();
  }
  container.content = out;
  if (
    (container.type === "listItem" || container.type === "taskItem") &&
    out[0]?.type !== "paragraph"
  ) {
    container.content = [{ type: "paragraph" }, ...out];
  }
}

const TASK_MARKER = /^\[( |x|X)\](?:\s+|$)/;

function taskMarkerOf(item: TiptapNode): { checked: boolean } | null {
  const first = item.content?.[0];
  const text = first?.type === "paragraph" ? first.content?.[0] : undefined;
  if (text?.type !== "text" || typeof text.text !== "string") {
    return null;
  }
  const match = TASK_MARKER.exec(text.text);
  return match ? { checked: match[1].toLowerCase() === "x" } : null;
}

// A bullet list whose items all start with `[ ]` or `[x]` is a task list.
// Mixed lists stay as bullets with the markers left in the text.
function convertTaskLists(node: TiptapNode) {
  for (const child of node.content ?? []) {
    convertTaskLists(child);
  }
  if (node.type !== "bulletList" || !node.content?.length) {
    return;
  }
  const markers = node.content.map(taskMarkerOf);
  if (markers.some((m) => m === null)) {
    return;
  }
  node.type = "taskList";
  node.content = node.content.map((item, i) => {
    const firstText = item.content?.[0]?.content?.[0];
    if (firstText?.text !== undefined) {
      firstText.text = firstText.text.replace(TASK_MARKER, "");
      if (firstText.text === "" && item.content?.[0]?.content) {
        item.content[0].content.shift();
        if (item.content[0].content.length === 0) {
          item.content[0].content = undefined;
        }
      }
    }
    return {
      type: "taskItem",
      attrs: { checked: markers[i]?.checked ?? false },
      content: item.content,
    };
  });
}

// Converts Markdown text to a Tiptap doc. Empty input is an error for comments;
// for a description it gives an empty document, which clears the description.
export function markdownToTiptap(
  markdown: string,
  opts: ConvertOptions = {}
): MarkdownResult {
  const description = opts.mode === "description";
  const empty = (): MarkdownResult =>
    description
      ? { ok: true, doc: { type: "doc", content: [{ type: "paragraph" }] } }
      : { error: "Comment text is empty." };

  if (typeof markdown !== "string" || markdown.trim().length === 0) {
    return empty();
  }
  const doc = buildDoc(md.parse(markdown, {}), opts, { mentions: 0 });
  if (description) {
    liftAttachments(doc);
    convertTaskLists(doc);
  }
  if (doc.content.length === 0) {
    return empty();
  }
  return { ok: true, doc };
}

export type MarkdownRefs = { mentionIds: string[]; attachmentIds: string[] };

// The user ids written as `<@id>` and the attachment ids written as
// `attachment:<id>` links or images, outside code. The caller looks these up in
// the database and passes the allowed ones back as `ConvertOptions`.
export function scanMarkdownRefs(markdown: string): MarkdownRefs {
  const mentionIds = new Set<string>();
  const attachmentIds = new Set<string>();
  if (typeof markdown !== "string") {
    return { mentionIds: [], attachmentIds: [] };
  }
  for (const token of md.parse(markdown, {})) {
    for (const child of token.children ?? []) {
      if (child.type === "text") {
        for (const match of child.content.matchAll(MENTION_PATTERN)) {
          mentionIds.add(match[1]);
        }
      } else if (child.type === "image" || child.type === "link_open") {
        const url = String(
          child.attrGet(child.type === "image" ? "src" : "href") ?? ""
        );
        const id = attachmentIdOf(url);
        if (id) {
          attachmentIds.add(id);
        }
      }
    }
  }
  return {
    mentionIds: [...mentionIds].slice(0, MAX_MENTIONS_PER_TEXT * 2),
    attachmentIds: [...attachmentIds].slice(0, 200),
  };
}
