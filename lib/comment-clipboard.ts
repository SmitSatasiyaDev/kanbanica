// Copy-to-clipboard for a comment: builds a plain-text, an HTML and (when
// possible) a PNG representation of the comment body, and writes them with the
// async Clipboard API. Everything browser-specific is injected through
// `ClipboardEnv`, so the whole flow is unit-testable in node.
//
// Rules this module keeps:
//  - text/plain is ALWAYS useful: inline images appear as their (absolute,
//    still auth-gated) URL, attachments as "Attachment: name / URL". An
//    image-only comment never copies as an empty string.
//  - Images are fetched through the existing authenticated /api/files URLs
//    (same-origin cookies) — no public URLs are created, no auth is bypassed.
//  - Clipboard only accepts PNG for images, so WebP/JPEG/etc. are converted
//    client-side (decode → canvas → PNG). Stored files are never changed.
//  - Any failure of the rich path falls back to plain text, silently.

interface DocNode {
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { attrs?: Record<string, unknown>; type: string }[];
  text?: string;
  type?: string;
}

export interface ClipboardAttachment {
  fileName: string;
  fileUrl: string; // storage key
  id: string;
  mimeType: string;
  url: string; // serving URL
}

export interface CommentClipboardContent {
  /** Absolute URLs of every image, in document order (inline first, then image attachments). */
  imageUrls: string[];
  /** Renders the HTML; `srcFor` maps an image URL to the `src` to embed. */
  renderHtml: (srcFor: (url: string) => string) => string;
  text: string;
}

const SAFE_LINK = /^(https?:|mailto:)/i;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function absoluteUrl(url: string, origin: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * Walks the Tiptap JSON once, producing the plain-text lines and an HTML
 * renderer in parallel. HTML is built from an allow-list of node/mark types
 * with every text value escaped — unknown nodes degrade to their text.
 */
export function buildCommentClipboardContent(
  doc: unknown,
  attachments: ClipboardAttachment[],
  origin: string
): CommentClipboardContent {
  const imageUrls: string[] = [];
  const referencedInline = new Set<string>();
  const lines: string[] = [];
  const htmlParts: ((srcFor: (url: string) => string) => string)[] = [];

  const inlineText = (node: DocNode): string => {
    if (typeof node.text === "string") {
      return node.text;
    }
    if (node.type === "mention") {
      return `@${str(node.attrs?.label) ?? str(node.attrs?.id) ?? "someone"}`;
    }
    if (node.type === "hardBreak") {
      return "\n";
    }
    return (node.content ?? []).map(inlineText).join("");
  };

  const inlineHtml = (node: DocNode): string => {
    if (typeof node.text === "string") {
      let out = escapeHtml(node.text);
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") {
          out = `<strong>${out}</strong>`;
        } else if (mark.type === "italic") {
          out = `<em>${out}</em>`;
        } else if (mark.type === "strike") {
          out = `<s>${out}</s>`;
        } else if (mark.type === "code") {
          out = `<code>${out}</code>`;
        } else if (mark.type === "link") {
          const href = str(mark.attrs?.href);
          if (href && SAFE_LINK.test(href)) {
            out = `<a href="${escapeHtml(href)}">${out}</a>`;
          }
        }
      }
      return out;
    }
    if (node.type === "mention") {
      return escapeHtml(inlineText(node));
    }
    if (node.type === "hardBreak") {
      return "<br>";
    }
    return (node.content ?? []).map(inlineHtml).join("");
  };

  const imageHtml =
    (url: string, alt: string) => (srcFor: (u: string) => string) =>
      `<p><img src="${escapeHtml(srcFor(url))}" alt="${escapeHtml(alt)}"></p>`;

  const addImage = (url: string, alt: string) => {
    imageUrls.push(url);
    lines.push(url);
    htmlParts.push(imageHtml(url, alt));
  };

  const list = (node: DocNode): ((s: (u: string) => string) => string) => {
    const ordered = node.type === "orderedList";
    const items: string[] = [];
    (node.content ?? []).forEach((li, i) => {
      const marker = ordered ? `${i + 1}. ` : "- ";
      const parts: string[] = [];
      (li.content ?? []).forEach((child, ci) => {
        const text = inlineText(child);
        if (ci === 0) {
          lines.push(marker + text);
        } else {
          lines.push(text);
        }
        parts.push(inlineHtml(child));
      });
      items.push(`<li>${parts.join("<br>")}</li>`);
    });
    const tag = ordered ? "ol" : "ul";
    return () => `<${tag}>${items.join("")}</${tag}>`;
  };

  const block = (node: DocNode) => {
    switch (node.type) {
      case "doc":
        for (const child of node.content ?? []) {
          block(child);
        }
        return;
      case "noteImage": {
        const key = str(node.attrs?.fileKey);
        if (!key) {
          return; // still uploading — nothing to copy yet
        }
        const id = str(node.attrs?.attachmentId);
        referencedInline.add(key);
        if (id) {
          referencedInline.add(id);
        }
        addImage(
          absoluteUrl(`/api/files/${key}`, origin),
          str(node.attrs?.alt) ?? ""
        );
        return;
      }
      case "bulletList":
      case "orderedList":
        htmlParts.push(list(node));
        return;
      case "heading": {
        const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
        lines.push(inlineText(node));
        htmlParts.push(() => `<h${level}>${inlineHtml(node)}</h${level}>`);
        return;
      }
      case "blockquote": {
        const text = (node.content ?? []).map(inlineText).join("\n");
        lines.push(
          text
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n")
        );
        htmlParts.push(
          () =>
            `<blockquote>${(node.content ?? [])
              .map((c) => `<p>${inlineHtml(c)}</p>`)
              .join("")}</blockquote>`
        );
        return;
      }
      case "codeBlock":
        lines.push(inlineText(node));
        htmlParts.push(
          () => `<pre><code>${escapeHtml(inlineText(node))}</code></pre>`
        );
        return;
      default:
        lines.push(inlineText(node));
        htmlParts.push(() => `<p>${inlineHtml(node)}</p>`);
    }
  };

  if (doc && typeof doc === "object") {
    block(doc as DocNode);
  }

  // Attachments that aren't already inline in the body: images are shown in
  // the comment's image grid, so they're copied like inline images; every
  // other file is listed by name + URL (never downloaded).
  for (const a of attachments) {
    if (referencedInline.has(a.fileUrl) || referencedInline.has(a.id)) {
      continue;
    }
    const url = absoluteUrl(a.url, origin);
    if (a.mimeType.startsWith("image/")) {
      addImage(url, a.fileName);
    } else {
      lines.push(`Attachment: ${a.fileName}\nURL: ${url}`);
      htmlParts.push(
        () =>
          `<p>Attachment: <a href="${escapeHtml(url)}">${escapeHtml(a.fileName)}</a></p>`
      );
    }
  }

  return {
    imageUrls,
    text: lines.join("\n").trim(),
    renderHtml: (srcFor) => htmlParts.map((p) => p(srcFor)).join(""),
  };
}

// ─── Browser side ────────────────────────────────────────────────────────────

export interface ClipboardEnv {
  clipboard?: {
    write?: (items: unknown[]) => Promise<void>;
    writeText?: (text: string) => Promise<void>;
  };
  /** Fetches an (auth-gated, same-origin) image and returns it as a PNG blob. */
  fetchPng: (url: string) => Promise<Blob>;
  makeItem?: (data: Record<string, Promise<Blob>>) => unknown;
  /** ClipboardItem.supports, when the browser has it. */
  supportsType?: (type: string) => boolean;
}

export type CopyResult = "rich" | "text";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Copies a comment. Tries a rich ClipboardItem (text/plain + text/html, plus
 * image/png for an image-only comment); on ANY failure or missing support it
 * falls back to writeText with the plain-text representation. Only throws if
 * even the text copy fails.
 */
export async function copyCommentToClipboard(
  content: CommentClipboardContent,
  env: ClipboardEnv,
  toDataUrl: (blob: Blob) => Promise<string> = blobToDataUrl
): Promise<CopyResult> {
  const { clipboard, makeItem } = env;
  const text = content.text;

  const textFallback = async (): Promise<CopyResult> => {
    if (!clipboard?.writeText) {
      throw new Error("Clipboard unavailable");
    }
    await clipboard.writeText(text);
    return "text";
  };

  const imageOnly = content.imageUrls.length === 1 && isImageOnly(content);
  const types = [
    "text/plain",
    "text/html",
    ...(imageOnly ? ["image/png"] : []),
  ];
  const richSupported =
    !!clipboard?.write &&
    !!makeItem &&
    types.every((t) => env.supportsType?.(t) ?? true);
  if (!richSupported) {
    return textFallback();
  }

  try {
    // PNGs are fetched once and shared by the html + image/png entries.
    const pngs = new Map<string, Promise<Blob>>();
    const png = (url: string) => {
      let p = pngs.get(url);
      if (!p) {
        p = env.fetchPng(url);
        pngs.set(url, p);
      }
      return p;
    };

    const htmlBlob = (async () => {
      // An image that can't be fetched/converted degrades to its URL in the
      // HTML (still auth-gated, so it only resolves for signed-in users).
      const embedded = new Map<string, string>();
      await Promise.all(
        content.imageUrls.map(async (url) => {
          try {
            embedded.set(url, await toDataUrl(await png(url)));
          } catch {
            // keep the URL
          }
        })
      );
      const html = content.renderHtml((url) => embedded.get(url) ?? url);
      return new Blob([html], { type: "text/html" });
    })();

    const data: Record<string, Promise<Blob>> = {
      "text/plain": Promise.resolve(new Blob([text], { type: "text/plain" })),
      "text/html": htmlBlob,
    };
    if (imageOnly) {
      data["image/png"] = png(content.imageUrls[0]);
    }

    await clipboard.write?.([makeItem?.(data)]);
    return "rich";
  } catch {
    return textFallback();
  }
}

// An image-only comment has no text other than its image URL(s).
function isImageOnly(content: CommentClipboardContent): boolean {
  return content.text === content.imageUrls.join("\n");
}

/** Decodes any browser-supported image and re-encodes it as PNG. */
export async function fetchImageAsPng(url: string): Promise<Blob> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    throw new Error(`Image fetch failed (${res.status})`);
  }
  const blob = await res.blob();
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error("Image too large to copy");
  }
  if (blob.type === "image/png") {
    return blob;
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas unavailable");
    }
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))),
        "image/png"
      )
    );
  } finally {
    bitmap.close();
  }
}

export function browserClipboardEnv(): ClipboardEnv {
  const Item =
    typeof ClipboardItem === "undefined"
      ? undefined
      : (ClipboardItem as typeof ClipboardItem & {
          supports?: (type: string) => boolean;
        });
  return {
    clipboard:
      typeof navigator === "undefined"
        ? undefined
        : (navigator.clipboard as ClipboardEnv["clipboard"]),
    fetchPng: fetchImageAsPng,
    makeItem: Item
      ? (data) => new Item(data as Record<string, Promise<Blob>>)
      : undefined,
    supportsType:
      Item && typeof Item.supports === "function"
        ? (type) => Item.supports?.(type) ?? true
        : undefined,
  };
}
