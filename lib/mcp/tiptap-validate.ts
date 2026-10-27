// Allowlist validator for Tiptap documents written through MCP. The comment
// service does no shape validation of its own, so this is the only guard
// between a model's output and the editor's renderer.
//
// Two modes. "comment" is what the comment editor can render. "description"
// adds what the task description editor registers on top: task lists and file
// chips, and attachment nodes inside quotes and list items.

export const SAFE_LINK = /^(https?:|mailto:)/i;

export const MAX_DOC_DEPTH = 20;
export const MAX_DOC_JSON_BYTES = 200_000;
const MAX_HREF_LENGTH = 2000;
const MAX_ATTR_STRING_LENGTH = 500;

type AttrCheck = (value: unknown) => boolean;

const isNullableString: AttrCheck = (value) =>
  value === null ||
  (typeof value === "string" && value.length <= MAX_ATTR_STRING_LENGTH);

const isInt =
  (min: number, max: number): AttrCheck =>
  (value) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max;

type NodeRule = {
  attrs: Record<string, AttrCheck>;
  // Node types allowed as children. Omitted means the node has no children.
  children?: ReadonlySet<string>;
};

export type DocMode = "comment" | "description";

const isBoolean: AttrCheck = (value) => typeof value === "boolean";
const isNullableSize: AttrCheck = (value) =>
  value === null ||
  (typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 1_000_000_000_000);

const BLOCKS = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "codeBlock",
  "horizontalRule",
] as const;
const INLINE = ["text", "hardBreak", "mention"] as const;

const NOTE_IMAGE_RULE: NodeRule = {
  attrs: {
    fileKey: isNullableString,
    attachmentId: isNullableString,
    alt: isNullableString,
  },
};

const NOTE_FILE_RULE: NodeRule = {
  attrs: {
    fileKey: isNullableString,
    attachmentId: isNullableString,
    fileName: isNullableString,
    fileSize: isNullableSize,
    mimeType: isNullableString,
  },
};

// The shape of Tiptap's Mention node. `label` is what the editor shows.
const MENTION_RULE: NodeRule = {
  attrs: {
    id: isNullableString,
    label: isNullableString,
    mentionSuggestionChar: isNullableString,
  },
};

function buildNodeRules(mode: DocMode): Record<string, NodeRule> {
  const description = mode === "description";
  // Blocks that can sit inside quotes and list items.
  const nested = new Set<string>([
    ...BLOCKS,
    ...(description ? ["taskList", "noteImage", "noteFile"] : []),
  ]);
  const rules: Record<string, NodeRule> = {
    doc: {
      attrs: {},
      children: new Set([
        ...BLOCKS,
        "noteImage",
        ...(description ? ["taskList", "noteFile"] : []),
      ]),
    },
    paragraph: { attrs: {}, children: new Set(INLINE) },
    text: { attrs: {} },
    hardBreak: { attrs: {} },
    mention: MENTION_RULE,
    heading: {
      attrs: { level: isInt(1, 6) },
      children: new Set(INLINE),
    },
    blockquote: { attrs: {}, children: nested },
    bulletList: { attrs: {}, children: new Set(["listItem"]) },
    orderedList: {
      attrs: { start: isInt(1, 1_000_000_000) },
      children: new Set(["listItem"]),
    },
    listItem: { attrs: {}, children: nested },
    codeBlock: {
      attrs: { language: isNullableString },
      children: new Set(["text"]),
    },
    horizontalRule: { attrs: {} },
    noteImage: NOTE_IMAGE_RULE,
  };
  if (description) {
    rules.taskList = { attrs: {}, children: new Set(["taskItem"]) };
    rules.taskItem = { attrs: { checked: isBoolean }, children: nested };
    rules.noteFile = NOTE_FILE_RULE;
  }
  return rules;
}

const RULES_BY_MODE: Record<DocMode, Record<string, NodeRule>> = {
  comment: buildNodeRules("comment"),
  description: buildNodeRules("description"),
};

const MARK_RULES: Record<string, Record<string, AttrCheck>> = {
  bold: {},
  italic: {},
  strike: {},
  code: {},
  underline: {},
  link: {
    href: (value) =>
      typeof value === "string" &&
      value.length <= MAX_HREF_LENGTH &&
      SAFE_LINK.test(value),
  },
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): ValidationResult => ({ ok: false, error });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkAttrs(
  attrs: unknown,
  rules: Record<string, AttrCheck>,
  owner: string
): string | null {
  if (attrs === undefined) {
    return null;
  }
  if (!isPlainObject(attrs)) {
    return `Invalid attrs on ${owner}`;
  }
  for (const [key, value] of Object.entries(attrs)) {
    const check = rules[key];
    if (!check) {
      return `Attribute "${key}" is not allowed on ${owner}`;
    }
    if (!check(value)) {
      return `Invalid value for "${key}" on ${owner}`;
    }
  }
  return null;
}

function checkMarks(marks: unknown): string | null {
  if (!Array.isArray(marks)) {
    return "Invalid marks";
  }
  for (const mark of marks) {
    if (!isPlainObject(mark) || typeof mark.type !== "string") {
      return "Invalid mark";
    }
    const rules = MARK_RULES[mark.type];
    if (!rules) {
      return `Mark "${mark.type}" is not allowed`;
    }
    for (const key of Object.keys(mark)) {
      if (key !== "type" && key !== "attrs") {
        return `Unexpected key "${key}" on mark`;
      }
    }
    const attrError = checkAttrs(mark.attrs, rules, `mark ${mark.type}`);
    if (attrError) {
      return attrError;
    }
    // A link without an href is useless and not a shape the editor writes.
    if (mark.type === "link" && !isPlainObject(mark.attrs)) {
      return "A link needs an href";
    }
  }
  return null;
}

function walk(
  node: unknown,
  depth: number,
  allowedHere: ReadonlySet<string> | null,
  rules: Record<string, NodeRule>
): string | null {
  if (depth > MAX_DOC_DEPTH) {
    return "Document is nested too deeply";
  }
  if (!isPlainObject(node) || typeof node.type !== "string") {
    return "Invalid node";
  }
  const type = node.type;
  const rule = rules[type];
  if (!rule) {
    return `Node "${type}" is not allowed`;
  }
  if (allowedHere && !allowedHere.has(type)) {
    return `Node "${type}" is not allowed here`;
  }
  for (const key of Object.keys(node)) {
    if (!["type", "attrs", "content", "text", "marks"].includes(key)) {
      return `Unexpected key "${key}" on ${type}`;
    }
  }

  const attrError = checkAttrs(node.attrs, rule.attrs, type);
  if (attrError) {
    return attrError;
  }

  if (type === "text") {
    if (typeof node.text !== "string" || node.text.length === 0) {
      return "Text nodes need non-empty text";
    }
    if (node.content !== undefined) {
      return "Text nodes cannot have content";
    }
    if (node.marks !== undefined) {
      return checkMarks(node.marks);
    }
    return null;
  }

  if (node.text !== undefined) {
    return `Node "${type}" cannot have text`;
  }
  if (node.marks !== undefined) {
    return `Node "${type}" cannot have marks`;
  }

  if (node.content === undefined) {
    return null;
  }
  if (!Array.isArray(node.content)) {
    return "Invalid content";
  }
  if (node.content.length > 0 && !rule.children) {
    return `Node "${type}" cannot have content`;
  }
  for (const child of node.content) {
    const childError = walk(child, depth + 1, rule.children ?? null, rules);
    if (childError) {
      return childError;
    }
  }
  return null;
}

// Rejects any node, mark or attribute outside the allowlist for the mode (the
// comment editor's by default), unsafe link targets, documents nested deeper
// than 20 levels, and documents larger than about 200 KB of JSON.
export function validateTiptapDoc(
  doc: unknown,
  opts: { mode?: DocMode } = {}
): ValidationResult {
  if (!isPlainObject(doc) || doc.type !== "doc") {
    return fail("The document must start with a doc node");
  }
  let json: string;
  try {
    json = JSON.stringify(doc);
  } catch {
    return fail("The document cannot be serialised");
  }
  if (json.length > MAX_DOC_JSON_BYTES) {
    return fail("The document is too large");
  }
  const error = walk(doc, 0, null, RULES_BY_MODE[opts.mode ?? "comment"]);
  return error ? fail(error) : { ok: true };
}
