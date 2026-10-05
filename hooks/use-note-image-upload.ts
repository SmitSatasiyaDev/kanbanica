"use client";

import type { Editor } from "@tiptap/react";
import * as React from "react";
import { toast } from "sonner";

// Image `File`s from a clipboard/drop FileList.
export function imageFilesFromList(list: FileList | null | undefined): File[] {
  if (!list) {
    return [];
  }
  return Array.from(list).filter((f) => f.type.startsWith("image/"));
}

function isImageFile(f: File): boolean {
  return f.type.startsWith("image/");
}

function newTempId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

interface UploadedFile {
  attachmentId: string;
  fileKey: string;
}

/**
 * Inline paste/drop/pick upload support for a Tiptap editor. Images are inserted
 * as the `noteImage` node (see components/task/note-image.tsx); when
 * `acceptAllFiles` is set, non-image files (PDF, DOC, …) are also accepted and
 * inserted as the `noteFile` chip node (components/task/note-file.tsx). Uploads
 * reuse the task attachments endpoint (`?inline=true`).
 *
 * Two modes:
 *  - **Immediate** (`taskId` set): each file uploads right away and its node is
 *    patched with the real storage key.
 *  - **Deferred** (`deferred: true`, no taskId yet — e.g. the create modal):
 *    files are inserted as placeholders only; call `flushPending(taskId)` after
 *    the task is created to upload them and rewrite the description.
 */
export function useNoteImageUpload(opts: {
  taskId?: string;
  deferred?: boolean;
  /** Accept any file type (PDF/DOC/etc.), not just images. */
  acceptAllFiles?: boolean;
}) {
  const editorRef = React.useRef<Editor | null>(null);
  const taskIdRef = React.useRef(opts.taskId);
  taskIdRef.current = opts.taskId;
  const deferredRef = React.useRef(opts.deferred);
  deferredRef.current = opts.deferred;
  const acceptAllRef = React.useRef(opts.acceptAllFiles);
  acceptAllRef.current = opts.acceptAllFiles;

  // tempId -> File, for deferred uploads flushed after task creation.
  const pendingRef = React.useRef<Map<string, File>>(new Map());
  const [uploadCount, setUploadCount] = React.useState(0);

  const setEditor = React.useCallback((e: Editor | null) => {
    editorRef.current = e;
  }, []);

  // Files from a FileList, filtered to what this controller accepts. Wrapped
  // in useCallback (stable identity, reads acceptAllRef.current at call time)
  // so it can safely sit in the dependency arrays below.
  const filesForMode = React.useCallback(
    (list: FileList | null | undefined): File[] => {
      if (!list) {
        return [];
      }
      const all = Array.from(list);
      return acceptAllRef.current ? all : all.filter(isImageFile);
    },
    []
  );

  // The attrs to write onto a node once its upload succeeds. Image and file
  // nodes have slightly different attr sets (previewSrc is image-only).
  function successPatch(file: File, up: UploadedFile): Record<string, unknown> {
    return isImageFile(file)
      ? {
          attachmentId: up.attachmentId,
          fileKey: up.fileKey,
          uploading: false,
          previewSrc: null,
        }
      : {
          attachmentId: up.attachmentId,
          fileKey: up.fileKey,
          uploading: false,
        };
  }

  // Update / remove the noteImage|noteFile node identified by its (temp) id.
  function patchNode(matchId: string, attrs: Record<string, unknown> | null) {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) {
      return;
    }
    const { state, view } = editor;
    let pos = -1;
    state.doc.descendants((node, p) => {
      if (
        (node.type.name === "noteImage" || node.type.name === "noteFile") &&
        node.attrs.attachmentId === matchId
      ) {
        pos = p;
        return false;
      }
      return true;
    });
    if (pos < 0) {
      return;
    }
    const node = state.doc.nodeAt(pos);
    if (!node) {
      return;
    }
    const tr = attrs
      ? state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
      : state.tr.delete(pos, pos + node.nodeSize);
    view.dispatch(tr);
  }

  function insertPlaceholder(
    tempId: string,
    file: File,
    uploading: boolean,
    previewSrc: string | null,
    at?: number
  ) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const node = isImageFile(file)
      ? {
          type: "noteImage",
          attrs: {
            attachmentId: tempId,
            uploading,
            previewSrc,
            alt: file.name,
          },
        }
      : {
          type: "noteFile",
          attrs: {
            attachmentId: tempId,
            uploading,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "application/octet-stream",
          },
        };
    // `at` = explicit position (ordered multi-part paste); otherwise the cursor.
    if (at === undefined) {
      editor.chain().focus().insertContent(node).run();
    } else {
      editor.chain().insertContentAt(at, node).run();
    }
  }

  async function uploadOne(
    taskId: string,
    file: File
  ): Promise<UploadedFile | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("inline", "true");
    const res = await fetch(`/api/tasks/${taskId}/attachments`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    const fileKey = data?.attachment?.key as string | undefined;
    const attachmentId = data?.attachment?.id as string | undefined;
    if (!fileKey || !attachmentId) {
      return null;
    }
    return { fileKey, attachmentId };
  }

  // Immediate mode: insert placeholder, upload, patch (or remove on failure).
  async function insertAndUpload(file: File, at?: number) {
    const taskId = taskIdRef.current;
    if (!taskId) {
      return;
    }
    const tempId = newTempId();
    const previewSrc = isImageFile(file) ? URL.createObjectURL(file) : null;
    setUploadCount((n) => n + 1);
    insertPlaceholder(tempId, file, true, previewSrc, at);
    try {
      const up = await uploadOne(taskId, file);
      if (!up) {
        throw new Error("upload failed");
      }
      patchNode(tempId, successPatch(file, up));
    } catch {
      patchNode(tempId, null);
      toast.error(`Couldn't upload ${isImageFile(file) ? "image" : "file"}`);
    } finally {
      if (previewSrc) {
        URL.revokeObjectURL(previewSrc);
      }
      setUploadCount((n) => Math.max(0, n - 1));
    }
  }

  // Deferred mode: insert a placeholder only; remember the File for flush.
  function insertPending(file: File, at?: number) {
    const tempId = newTempId();
    const previewSrc = isImageFile(file) ? URL.createObjectURL(file) : null;
    pendingRef.current.set(tempId, file);
    insertPlaceholder(tempId, file, false, previewSrc, at);
  }

  function handleFiles(files: File[], at?: number) {
    for (const f of files) {
      if (deferredRef.current) {
        insertPending(f, at);
      } else if (taskIdRef.current) {
        void insertAndUpload(f, at);
      }
    }
  }

  // Stable handlers (created once) that always call the latest logic.
  const handleFilesRef = React.useRef(handleFiles);
  handleFilesRef.current = handleFiles;

  // Rich HTML pastes (e.g. a comment copied with its Copy button, or content
  // from Gmail) carry images as `data:` URLs rather than as clipboard files, and
  // the schema would silently drop them. Re-insert the text/html in order and
  // turn each embedded image into a normal inline upload.
  const pasteHtmlWithImages = React.useCallback(async (html: string) => {
    const body = new DOMParser().parseFromString(html, "text/html").body;
    const steps: ({ html: string } | { file: File })[] = [];
    let chunk = "";
    const flush = () => {
      if (chunk.trim()) {
        steps.push({ html: chunk });
      }
      chunk = "";
    };
    let n = 0;
    for (const node of Array.from(body.children)) {
      const imgs = Array.from(node.querySelectorAll("img")).filter((i) =>
        i.src.startsWith("data:image/")
      );
      if (node instanceof HTMLImageElement) {
        imgs.push(...(node.src.startsWith("data:image/") ? [node] : []));
      }
      if (imgs.length === 0) {
        chunk += node.outerHTML;
        continue;
      }
      const rest = node.cloneNode(true) as Element;
      for (const img of Array.from(rest.querySelectorAll("img"))) {
        img.remove();
      }
      if (rest.textContent?.trim()) {
        chunk += rest.outerHTML;
      }
      flush();
      for (const img of imgs) {
        try {
          const blob = await (await fetch(img.src)).blob();
          const ext = blob.type.split("/")[1] || "png";
          steps.push({
            file: new File([blob], `pasted-image-${++n}.${ext}`, {
              type: blob.type,
            }),
          });
        } catch {
          // unreadable image — skip it, keep the rest
        }
      }
    }
    flush();
    // Insert at explicit, advancing positions. Using the live selection here
    // would be wrong: after an atom image node is inserted the selection sits
    // on it, so the next chunk would REPLACE the image.
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.commands.deleteSelection();
    let pos = editor.state.selection.from;
    for (const step of steps) {
      const before = editor.state.doc.content.size;
      if ("html" in step) {
        editor.chain().insertContentAt(pos, step.html).run();
      } else {
        handleFilesRef.current([step.file], pos);
      }
      pos = Math.min(
        pos + (editor.state.doc.content.size - before),
        editor.state.doc.content.size
      );
    }
    editor.commands.focus();
  }, []);

  const handlePaste = React.useCallback(
    (_view: unknown, event: ClipboardEvent) => {
      const files = filesForMode(event.clipboardData?.files);
      if (files.length === 0) {
        const html = event.clipboardData?.getData("text/html") ?? "";
        if (/<img[^>]+src=["']data:image\//i.test(html)) {
          event.preventDefault();
          void pasteHtmlWithImages(html);
          return true;
        }
        return false;
      }
      event.preventDefault();
      handleFilesRef.current(files);
      return true;
    },
    [filesForMode, pasteHtmlWithImages]
  );

  const handleDrop = React.useCallback(
    (_view: unknown, event: DragEvent) => {
      const files = filesForMode(event.dataTransfer?.files);
      if (files.length === 0) {
        return false;
      }
      event.preventDefault();
      handleFilesRef.current(files);
      return true;
    },
    [filesForMode]
  );

  const pickAndUpload = React.useCallback(
    (fileList: FileList | null) => {
      handleFilesRef.current(filesForMode(fileList));
    },
    [filesForMode]
  );

  /**
   * Deferred mode: upload every pending file against the now-known task, patch
   * the successfully-uploaded nodes in the live editor, drop the failed ones,
   * and return counts + the final description JSON to persist.
   */
  async function flushPending(taskId: string): Promise<{
    total: number;
    uploaded: number;
    failed: number;
    doc: unknown;
  }> {
    const entries = [...pendingRef.current.entries()];
    let uploaded = 0;
    let failed = 0;
    setUploadCount((n) => n + entries.length);
    try {
      await Promise.all(
        entries.map(async ([tempId, file]) => {
          const up = await uploadOne(taskId, file).catch(() => null);
          if (up) {
            uploaded++;
            patchNode(tempId, successPatch(file, up));
          } else {
            failed++;
            patchNode(tempId, null); // drop the failed placeholder
          }
        })
      );
    } finally {
      setUploadCount((n) => Math.max(0, n - entries.length));
      pendingRef.current.clear();
    }
    const editor = editorRef.current;
    const doc = editor && !editor.isDestroyed ? editor.getJSON() : null;
    return { total: entries.length, uploaded, failed, doc };
  }

  const hasPending = () => pendingRef.current.size > 0;

  // Clear pending (deferred) state — call when a reused composer resets (e.g.
  // the create modal reopening) so stale files aren't uploaded later.
  const reset = React.useCallback(() => {
    pendingRef.current.clear();
    setUploadCount(0);
  }, []);

  return {
    setEditor,
    handlePaste,
    handleDrop,
    pickAndUpload,
    flushPending,
    hasPending,
    reset,
    uploading: uploadCount > 0,
  };
}
