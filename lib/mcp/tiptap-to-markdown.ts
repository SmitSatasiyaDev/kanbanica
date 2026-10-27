import { SAFE_LINK } from "@/lib/mcp/tiptap-validate";
import { toTiptapDoc } from "@/lib/notes";

// Tiptap JSON to Markdown, for the text an agent reads. A pure walker over the
// comment nodes plus the description-only ones (task lists, files). Anything
// unknown degrades to its text. Images and files become `attachment:<id>` links:
// the agent fetches the bytes with `get_attachment`, because /api/files URLs
// need a browser cookie.

type Mark = { type?: string; attrs?: Record<string, unknown> };
type Node = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
  marks?: Mark[];
};

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function escapeLabel(value: string): string {
  return value.replace(/[[\]\\]/g, "\\$&").replace(/\r?\n/g, " ");
}

// Plain text of a node and everything below it (used for unknown nodes).
function plainText(node: Node): string {
  if (typeof node.text === "string") {
    return node.text;
  }
  if (node.type === "mention") {
    return `@${str(node.attrs?.label) ?? str(node.attrs?.id) ?? "someone"}`;
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  const children = node.content ?? [];
  const separator = children.some((c) => isBlockLike(c)) ? "\n" : "";
  return children.map(plainText).join(separator);
}

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "codeBlock",
  "horizontalRule",
  "noteImage",
  "noteFile",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);

function isBlockLike(node: Node): boolean {
  return !!node.type && BLOCK_TYPES.has(node.type);
}

// Wraps text in a code span long enough to hold any backticks it contains.
function codeSpan(text: string): string {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((r) => r.length)
  );
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function textWithMarks(node: Node): string {
  const text = node.text ?? "";
  const marks = node.marks ?? [];
  // Markers must hug the words, so surrounding spaces stay outside them.
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const lead = match?.[1] ?? "";
  let core = match?.[2] ?? text;
  const trail = match?.[3] ?? "";
  if (!core) {
    return text;
  }
  for (const mark of marks) {
    switch (mark.type) {
      case "code":
        core = codeSpan(core);
        break;
      case "bold":
        core = `**${core}**`;
        break;
      case "italic":
        core = `*${core}*`;
        break;
      case "strike":
        core = `~~${core}~~`;
        break;
      case "link": {
        const href = str(mark.attrs?.href);
        if (href && SAFE_LINK.test(href)) {
          core = `[${core}](${href})`;
        }
        break;
      }
      default:
        // Underline and unknown marks have no Markdown form.
        break;
    }
  }
  return lead + core + trail;
}

function inline(node: Node): string {
  if (typeof node.text === "string") {
    return textWithMarks(node);
  }
  switch (node.type) {
    case "hardBreak":
      return "\n";
    case "mention":
      return mentionToken(node);
    case "noteImage":
    case "noteFile":
      return attachmentLink(node);
    default:
      return (node.content ?? []).map(inline).join("");
  }
}

// `<@userId|Name>`: the form add_comment and update_task read back as a real
// mention (when the user is still allowed). Ids that do not look like ours fall
// back to plain `@Name`.
function mentionToken(node: Node): string {
  const id = str(node.attrs?.id);
  const label = (str(node.attrs?.label) ?? "")
    .replace(/[<>|\r\n]/g, " ")
    .trim()
    .slice(0, 100);
  if (!(id && /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
    return `@${label || id || "someone"}`;
  }
  return label ? `<@${id}|${label}>` : `<@${id}>`;
}

function attachmentLink(node: Node): string {
  const id = str(node.attrs?.attachmentId);
  if (node.type === "noteImage") {
    const alt = escapeLabel(str(node.attrs?.alt) ?? "image");
    return id ? `![${alt}](attachment:${id})` : `[image: ${alt}]`;
  }
  const name = escapeLabel(str(node.attrs?.fileName) ?? "file");
  return id ? `[${name}](attachment:${id})` : `[file: ${name}]`;
}

function prefixLines(text: string, first: string, rest: string): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? first : rest) + line)
    .join("\n")
    .replace(/[ ]+$/gm, "");
}

function listItems(node: Node, marker: (i: number, item: Node) => string) {
  return (node.content ?? [])
    .map((item, i) => {
      const body = blocks(item.content ?? []);
      const first = marker(i, item);
      return prefixLines(body, first, " ".repeat(first.length));
    })
    .join("\n");
}

function block(node: Node): string {
  switch (node.type) {
    case "paragraph":
      return inline(node);
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      return `${"#".repeat(level)} ${inline(node)}`;
    }
    case "blockquote":
      return blocks(node.content ?? [])
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    case "bulletList":
      return listItems(node, () => "- ");
    case "orderedList": {
      const start = Number(node.attrs?.start) || 1;
      return listItems(node, (i) => `${start + i}. `);
    }
    case "taskList":
      return listItems(node, (_, item) =>
        item.attrs?.checked ? "- [x] " : "- [ ] "
      );
    case "codeBlock": {
      const text = plainText(node);
      const longest = Math.max(
        0,
        ...(text.match(/`{3,}/g) ?? []).map((r) => r.length)
      );
      const fence = "`".repeat(Math.max(3, longest + 1));
      const language = str(node.attrs?.language) ?? "";
      return `${fence}${language}\n${text}\n${fence}`;
    }
    case "horizontalRule":
      return "---";
    case "noteImage":
    case "noteFile":
      return attachmentLink(node);
    default:
      // Unknown block (tables and similar): keep the text, one line per block.
      return plainText(node);
  }
}

function blocks(nodes: Node[]): string {
  return nodes
    .map(block)
    .filter((text) => text !== "")
    .join("\n\n");
}

// Converts a stored Tiptap body (an object, or a JSON string as task
// descriptions are stored) to Markdown. Returns "" for an empty or unreadable
// body.
export function tiptapToMarkdown(body: unknown): string {
  const doc = toTiptapDoc(body);
  if (!doc || typeof doc !== "object") {
    return "";
  }
  const root = doc as Node;
  const text =
    root.type === "doc" ? blocks(root.content ?? []) : block(root as Node);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
