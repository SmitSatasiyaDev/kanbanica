"use client";

import {
  AtIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CodeBlockIcon,
  CopyIcon,
  FileIcon,
  FilePdfIcon,
  ImageIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  PaperclipIcon,
  PaperPlaneRightIcon,
  ParagraphIcon,
  PencilSimpleIcon,
  PlusIcon,
  QuotesIcon,
  SmileyIcon,
  TextHOneIcon,
  TextHThreeIcon,
  TextHTwoIcon,
  ThumbsUpIcon,
  TrashIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import Link from "@tiptap/extension-link";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { format, formatDistanceToNow } from "date-fns";
import * as React from "react";
import { toast } from "sonner";
import {
  getWorkspaceMentionMembers,
  type MentionMember,
} from "@/app/actions/mention";
import { useRealtimeRefetch } from "@/components/realtime/realtime-provider";
import { buildMentionSuggestion } from "@/components/task/mention-suggestion";
import { NoteImage } from "@/components/task/note-image";
import {
  type SlashCommand,
  SlashCommandGrid,
  SlashCommandMenu,
  useSlashCommands,
} from "@/components/task/slash-command-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNoteImageUpload } from "@/hooks/use-note-image-upload";
import { describeEvent } from "@/lib/activity-descriptions";
import {
  browserClipboardEnv,
  buildCommentClipboardContent,
  copyCommentToClipboard,
} from "@/lib/comment-clipboard";
import { LINK_OPTIONS } from "@/lib/tiptap-link";
import { cn } from "@/lib/utils";

// Slash commands for the comment composer — mirror its "+" formatting menu.
const COMMENT_SLASH_COMMANDS: SlashCommand[] = [
  {
    key: "paragraph",
    label: "Normal text",
    desc: "Plain paragraph",
    keywords: "text paragraph normal",
    icon: ParagraphIcon,
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    key: "h1",
    label: "Heading 1",
    desc: "Large heading",
    keywords: "h1 heading title",
    icon: TextHOneIcon,
    run: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    key: "h2",
    label: "Heading 2",
    desc: "Medium heading",
    keywords: "h2 heading",
    icon: TextHTwoIcon,
    run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    key: "h3",
    label: "Heading 3",
    desc: "Small heading",
    keywords: "h3 heading",
    icon: TextHThreeIcon,
    run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    key: "bulletList",
    label: "Bullet list",
    desc: "Unordered list",
    keywords: "bullet unordered list ul",
    icon: ListBulletsIcon,
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    key: "orderedList",
    label: "Numbered list",
    desc: "Ordered list",
    keywords: "numbered ordered list ol",
    icon: ListNumbersIcon,
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    key: "blockquote",
    label: "Blockquote",
    desc: "Block quote",
    keywords: "quote blockquote",
    icon: QuotesIcon,
    run: (e) => e.chain().focus().setBlockquote().run(),
  },
  {
    key: "codeBlock",
    label: "Code block",
    desc: "Code snippet",
    keywords: "code block",
    icon: CodeBlockIcon,
    run: (e) => e.chain().focus().setCodeBlock().run(),
  },
];

import dynamic from "next/dynamic";
import {
  type CommentAttachment,
  type CommentWithReplies,
  createComment,
  deleteComment,
  editComment,
  getTaskComments,
  resolveComment,
  toggleReaction,
  unresolveComment,
} from "@/app/actions/comment";
import { getTaskActivity } from "@/app/actions/task";
import { useAttachmentPreview } from "@/components/task/attachment-preview-modal";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Stable reference — emoji-mart's Picker reprocesses/re-indexes the entire
// emoji dataset whenever its `data` prop identity changes, so this must stay
// a single shared function rather than an inline arrow recreated per render
// (which was causing a re-index, and a visible lag, on every popover open).
const loadEmojiData = () =>
  import("@emoji-mart/data").then((mod) => mod.default);

const EmojiPicker = dynamic(() => import("@emoji-mart/react"), {
  ssr: false,
  loading: () => (
    <div className="w-88 max-w-[calc(100vw-2rem)] p-3 space-y-2">
      <div className="h-8 rounded-md bg-base-200 animate-pulse" />
      <div className="flex gap-1 pb-1 border-b border-base-300">
        {Array.from({ length: 9 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static skeleton, never reordered
          <div className="size-7 rounded bg-base-200 animate-pulse" key={i} />
        ))}
      </div>
      <div className="h-3 w-20 rounded bg-base-200 animate-pulse" />
      <div className="grid grid-cols-8 gap-1">
        {Array.from({ length: 40 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static skeleton, never reordered
          <div className="size-8 rounded bg-base-200 animate-pulse" key={i} />
        ))}
      </div>
    </div>
  ),
});

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityEntry {
  createdAt: Date;
  email: string | null;
  eventType: string;
  id: string;
  image?: string | null;
  meta: unknown;
  name: string | null;
}

interface FeedItem {
  activity?: ActivityEntry;
  comment?: CommentWithReplies;
  createdAt: Date;
  type: "comment" | "activity";
}

export interface TaskActivityFeedHandle {
  refresh: () => void;
}

interface TaskActivityFeedProps {
  currentUserId: string;
  /** Hide the built-in "Activity" label (a parent header already supplies it). */
  hideHeader?: boolean;
  isAdmin?: boolean;
  listId: string;
  spaceId: string;
  taskId: string;
  /**
   * How the composer is pinned to the bottom of the panel:
   * - "fill"   — the feed owns its parent's full height: the activity list is
   *   the scroll container and the composer is a flex footer (full task page).
   * - "inline" — the feed is one section inside a taller scroll column, so the
   *   composer sticks to the bottom of that scrollport instead (drawer).
   */
  variant?: "fill" | "inline";
  workspaceId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string | null, email: string | null) {
  const n = name?.trim();
  if (n) {
    return n
      .split(" ")
      .map((s) => s[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return (email ?? "?").slice(0, 2).toUpperCase();
}

function avatarSrc(key: string | null | undefined): string | undefined {
  return key ? `/api/files/${key}` : undefined;
}

// ─── Comment editor ───────────────────────────────────────────────────────────

function CommentEditor({
  placeholder,
  onSubmit,
  onCancel,
  initialContent,
  autoFocus,
  enableAttachments,
  compact,
  members,
  taskId,
}: {
  placeholder?: string;
  onSubmit: (content: unknown, files: File[]) => Promise<void>;
  onCancel?: () => void;
  initialContent?: unknown;
  autoFocus?: boolean;
  enableAttachments?: boolean;
  compact?: boolean;
  members?: MentionMember[];
  taskId?: string;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);
  const [editorEmpty, setEditorEmpty] = React.useState(!initialContent);
  const [plusOpen, setPlusOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  // Stable refs so the editor's handleKeyDown always calls the latest versions
  const submitRef = React.useRef<() => void>(() => undefined);
  const splitListItemRef = React.useRef<() => void>(() => undefined);
  const isMentionActiveRef = React.useRef(false);
  // Inline-image paste/drop upload is available when we know the task.
  const canInlineImages = !!taskId;
  const imageUpload = useNoteImageUpload({ taskId });

  // Keep a ref so the mention suggestion always reads the latest members list,
  // even though the Tiptap extension is created only once on mount.
  const membersRef = React.useRef<MentionMember[]>(members ?? []);
  React.useEffect(() => {
    membersRef.current = members ?? [];
  }, [members]);

  const slashMenu = useSlashCommands(COMMENT_SLASH_COMMANDS);

  const mentionExtension = React.useMemo(
    () =>
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        renderText: ({ node }) =>
          `@${(node.attrs.label as string | null) ?? (node.attrs.id as string) ?? "someone"}`,
        suggestion: buildMentionSuggestion(
          () => membersRef.current,
          (active) => {
            isMentionActiveRef.current = active;
          }
        ),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder ?? "Write a comment…" }),
      mentionExtension,
      NoteImage,
      Link.configure(LINK_OPTIONS),
    ],
    content: (initialContent as object) ?? "",
    autofocus: autoFocus,
    onUpdate: ({ editor: e }) => {
      setEditorEmpty(e.isEmpty);
      slashMenu.refresh(e);
    },
    onSelectionUpdate: ({ editor: e }) => slashMenu.refresh(e),
    onBlur: () => slashMenu.close(),
    editorProps: {
      // Paste a screenshot / drop image files → upload inline. Non-image
      // pastes/drops fall through to Tiptap's default handling (unchanged).
      handlePaste: (view, event) =>
        canInlineImages ? imageUpload.handlePaste(view, event) : false,
      handleDrop: (view, event) =>
        canInlineImages
          ? imageUpload.handleDrop(view, event as DragEvent)
          : false,
      handleKeyDown: (view, event) => {
        // Slash command menu takes priority while it's open.
        if (slashMenu.handleKeyDown(event)) {
          return true;
        }
        if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
          // Let the mention suggestion handle Enter when popup is open
          if (isMentionActiveRef.current) {
            return false;
          }
          const { $from } = view.state.selection;
          let inListItem = false;
          let inFormattedBlock = false;
          for (let d = $from.depth; d > 0; d--) {
            const name = $from.node(d).type.name;
            if (name === "listItem") {
              inListItem = true;
              break;
            }
            if (
              name === "heading" ||
              name === "blockquote" ||
              name === "codeBlock"
            ) {
              inFormattedBlock = true;
              break;
            }
          }
          // Shift+Enter inside a list → new list item (same as plain Enter)
          if (event.shiftKey && inListItem) {
            splitListItemRef.current();
            return true;
          }
          // Any Enter inside a formatted block → let Tiptap handle natively
          if (inFormattedBlock || inListItem) {
            return false;
          }
          // Plain Enter in a paragraph → submit
          if (!event.shiftKey) {
            submitRef.current();
            return true;
          }
        }
        return false;
      },
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none outline-none px-3 py-2.5 text-sm",
          compact ? "min-h-[44px]" : "min-h-[72px]",
          // Cap the visual height: the editor grows with its content up to
          // this limit, then scrolls internally so the toolbar + Send button
          // below it are never pushed out of the composer by a large paste.
          // The content itself is never truncated.
          "max-h-[min(40vh,320px)] overflow-y-auto overscroll-contain break-words"
        ),
      },
    },
  });

  const setImageEditor = imageUpload.setEditor;
  React.useEffect(() => {
    slashMenu.setEditor(editor);
    setImageEditor(editor);
  }, [editor, slashMenu, setImageEditor]);

  function handleImageButton(e: React.ChangeEvent<HTMLInputElement>) {
    imageUpload.pickAndUpload(e.target.files);
    e.target.value = "";
  }

  async function handleSubmit() {
    if (!editor || imageUpload.uploading) {
      return;
    }
    if (editorEmpty && pendingFiles.length === 0) {
      return;
    }
    setSubmitting(true);
    try {
      // Deep-clone through JSON.parse/stringify to convert ProseMirror's
      // null-prototype attrs objects into plain objects — React Flight (server
      // action transport) drops null-prototype object properties silently.
      const body = JSON.parse(JSON.stringify(editor.getJSON())) as unknown;
      await onSubmit(body, pendingFiles);
      editor.commands.clearContent();
      setPendingFiles([]);
      setEditorEmpty(true);
    } finally {
      setSubmitting(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  function removeFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Block submit while an inline image is still uploading (a note must not be
  // posted with a placeholder image node).
  const canSubmit =
    (!editorEmpty || pendingFiles.length > 0) && !imageUpload.uploading;

  // Keep submitRef pointing at the latest handleSubmit so the editor keydown
  // closure (created once) always calls the current version.
  submitRef.current = () => void handleSubmit();
  splitListItemRef.current = () => {
    editor?.chain().splitListItem("listItem").run();
  };

  return (
    <div className="rounded-xl border bg-base-100 shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all">
      <EditorContent editor={editor} />
      <SlashCommandMenu menu={slashMenu} />

      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pb-2 border-t pt-2">
          {pendingFiles.map((file, i) => (
            <div
              className="flex items-center gap-1.5 rounded-md border bg-base-200/40 px-2 py-1 text-xs"
              key={`${file.name}-${file.size}-${file.lastModified}`}
            >
              {file.type.startsWith("image/") ? (
                // biome-ignore lint/performance/noImgElement: transient local objectURL preview
                <img
                  alt={file.name}
                  className="size-4 object-cover rounded"
                  src={URL.createObjectURL(file)}
                />
              ) : file.type === "application/pdf" ? (
                <FilePdfIcon className="size-4 text-red-500 shrink-0" />
              ) : (
                <FileIcon className="size-4 text-base-content/60 shrink-0" />
              )}
              <span className="truncate max-w-28">{file.name}</span>
              <button
                className="text-base-content/60 hover:text-error shrink-0"
                onClick={() => removeFile(i)}
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar — wraps instead of overflowing on narrow composers (mobile
        full task page / drawer) since it holds several icon buttons plus the
        submit group. */}
      <div className="flex flex-wrap items-center gap-y-1 gap-x-0.5 border-t px-2 py-1.5">
        {/* Plus — formatting menu */}
        <Popover onOpenChange={setPlusOpen} open={plusOpen}>
          <PopoverTrigger asChild>
            <button
              className="size-11 sm:size-7 flex items-center justify-center rounded-md hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors"
              type="button"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-110 max-w-[calc(100vw-2rem)] p-1.5 mb-1"
            side="top"
          >
            <SlashCommandGrid
              commands={COMMENT_SLASH_COMMANDS}
              onSelect={(cmd) => {
                if (editor) {
                  cmd.run(editor);
                }
                setPlusOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>

        <div className="w-px h-4 bg-base-300 mx-1" />

        {/* Emoji */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="size-11 sm:size-7 flex items-center justify-center rounded-md hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors"
              type="button"
            >
              <SmileyIcon className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto max-w-[calc(100vw-2rem)] overflow-x-auto p-0 border-0 shadow-lg"
          >
            <EmojiPicker
              data={loadEmojiData}
              maxFrequentRows={2}
              onEmojiSelect={(e: { native: string }) =>
                editor?.commands.insertContent(e.native)
              }
              perLine={8}
              previewPosition="none"
              skinTonePosition="none"
              theme={
                typeof document !== "undefined" &&
                document.documentElement.classList.contains("dark")
                  ? "dark"
                  : "light"
              }
            />
          </PopoverContent>
        </Popover>

        {/* Attach */}
        {enableAttachments && (
          <>
            <button
              className="size-11 sm:size-7 flex items-center justify-center rounded-md hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors"
              onClick={() => fileInputRef.current?.click()}
              title="Attach file"
              type="button"
            >
              <PaperclipIcon className="size-4" />
            </button>
            <input
              className="hidden"
              multiple
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
          </>
        )}

        {/* Inline image (paste, drop, or pick) */}
        {canInlineImages && (
          <>
            <button
              className="size-11 sm:size-7 flex items-center justify-center rounded-md hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors"
              onClick={() => imageInputRef.current?.click()}
              title="Add image"
              type="button"
            >
              <ImageIcon className="size-4" />
            </button>
            <input
              accept="image/*"
              className="hidden"
              multiple
              onChange={handleImageButton}
              ref={imageInputRef}
              type="file"
            />
          </>
        )}

        {/* Mention */}
        <button
          className="size-11 sm:size-7 flex items-center justify-center rounded-md hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors"
          onClick={() => editor?.chain().focus().insertContent("@").run()}
          type="button"
        >
          <AtIcon className="size-4" />
        </button>

        {/* Right: cancel + submit */}
        <div className="flex-1" />

        {onCancel && (
          <button
            className="text-xs text-base-content/60 hover:text-base-content px-2 py-1 rounded-md hover:bg-base-200 transition-colors mr-1"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        )}

        {/* Submit group */}
        <div
          className={cn(
            "flex items-stretch rounded-lg overflow-hidden border transition-colors",
            canSubmit
              ? "border-primary bg-primary"
              : "border-base-300 bg-base-200/40"
          )}
        >
          <button
            className={cn(
              "flex items-center px-3 py-1.5 text-xs font-medium transition-colors",
              canSubmit
                ? "text-primary-content hover:bg-white/10"
                : "text-base-content/60 cursor-not-allowed"
            )}
            disabled={submitting || !canSubmit}
            onClick={handleSubmit}
            type="button"
          >
            {submitting ? <span>Sending…</span> : <span>Comment</span>}
          </button>
          <div
            className={cn(
              "w-px shrink-0",
              canSubmit ? "bg-white/25" : "bg-base-300"
            )}
          />
          <button
            className={cn(
              "flex items-center justify-center px-2 transition-colors",
              canSubmit
                ? "text-primary-content hover:bg-white/10"
                : "text-base-content/60 cursor-not-allowed"
            )}
            disabled={submitting || !canSubmit}
            onClick={handleSubmit}
            type="button"
          >
            <PaperPlaneRightIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Comment body renderer ────────────────────────────────────────────────────

function CommentBody({ body }: { body: unknown }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        renderText: ({ node }) =>
          `@${(node.attrs.label as string | null) ?? (node.attrs.id as string) ?? "someone"}`,
      }),
      NoteImage,
      Link.configure(LINK_OPTIONS),
    ],
    content: (body as object) ?? "",
    editable: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none outline-none text-sm",
      },
    },
  });

  // Tiptap only applies `content` at init. When the comment is edited and the
  // feed refetches, the `body` prop changes but the editor keeps the old text
  // until it remounts — so push new content into the editor on every change.
  // Deferred to a microtask: with the NoteImage React NodeView, setContent
  // triggers a synchronous React flush that's illegal inside an effect.
  React.useEffect(() => {
    if (!editor) {
      return;
    }
    const next = (body as object) ?? "";
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) {
      queueMicrotask(() => {
        if (!editor.isDestroyed) {
          editor.commands.setContent(next);
        }
      });
    }
  }, [body, editor]);

  return <EditorContent editor={editor} />;
}

// ─── Comment attachments ──────────────────────────────────────────────────────

function CommentAttachments({
  attachments,
}: {
  attachments: CommentAttachment[];
}) {
  const preview = useAttachmentPreview();
  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const files = attachments.filter((a) => !a.mimeType.startsWith("image/"));

  // Open in the in-app preview modal; fall back to a new tab if no provider.
  function openAttachment(a: CommentAttachment) {
    if (preview) {
      preview.open({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
        url: a.url,
      });
    } else {
      window.open(a.url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="px-3 pb-2 space-y-2">
      {/* Image grid */}
      {images.length > 0 && (
        <div
          className={cn(
            "grid gap-1.5",
            images.length === 1
              ? "grid-cols-1"
              : images.length === 2
                ? "grid-cols-2"
                : "grid-cols-3"
          )}
        >
          {images.map((img) => (
            <button
              className="block overflow-hidden rounded-lg border bg-base-200/30 hover:opacity-90 transition-opacity"
              key={img.id}
              onClick={() => openAttachment(img)}
              type="button"
            >
              {/* biome-ignore lint/performance/noImgElement: served from auth-gated /api/files storage keys; next/image can't optimize these */}
              <img
                alt={img.fileName}
                className={cn(
                  "w-full object-cover",
                  images.length === 1 ? "max-h-64" : "h-28"
                )}
                src={img.url}
              />
            </button>
          ))}
        </div>
      )}

      {/* File cards */}
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((file) => (
            <button
              className="flex w-full items-center gap-2 rounded-lg border bg-base-200/30 px-3 py-2 text-left hover:bg-base-200 transition-colors"
              key={file.id}
              onClick={() => openAttachment(file)}
              type="button"
            >
              {file.mimeType === "application/pdf" ? (
                <FilePdfIcon className="size-4 text-red-500 shrink-0" />
              ) : (
                <FileIcon className="size-4 text-base-content/60 shrink-0" />
              )}
              <span className="text-xs font-medium truncate flex-1">
                {file.fileName}
              </span>
              <span className="text-2xs text-base-content/60 shrink-0">
                {(file.fileSize / 1024).toFixed(0)} KB
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Single comment ───────────────────────────────────────────────────────────

function CommentItem({
  comment,
  workspaceId,
  spaceId,
  listId,
  taskId,
  currentUserId,
  isAdmin,
  depth,
  onRefresh,
  members,
}: {
  comment: CommentWithReplies;
  workspaceId: string;
  spaceId: string;
  listId: string;
  taskId: string;
  currentUserId: string;
  isAdmin?: boolean;
  depth: number;
  onRefresh: () => void;
  members: MentionMember[];
}) {
  const [replying, setReplying] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [repliesOpen, setRepliesOpen] = React.useState(true);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const isAuthor = comment.authorId === currentUserId;
  const canDelete = isAuthor || isAdmin;
  const canResolve = isAuthor || isAdmin;
  const displayName =
    comment.authorName?.trim() || comment.authorEmail || "Unknown";

  async function handleDelete() {
    await deleteComment(workspaceId, spaceId, listId, taskId, comment.id);
    onRefresh();
  }

  async function handleReply(body: unknown, _files: File[]) {
    await createComment(workspaceId, spaceId, listId, taskId, body, comment.id);
    setReplying(false);
    onRefresh();
  }

  async function handleEdit(body: unknown, _files: File[]) {
    await editComment(workspaceId, spaceId, listId, comment.id, body);
    setEditing(false);
    onRefresh();
  }

  async function handleResolve() {
    if (comment.isResolved) {
      await unresolveComment(workspaceId, spaceId, listId, comment.id);
    } else {
      await resolveComment(workspaceId, spaceId, listId, comment.id);
    }
    onRefresh();
  }

  async function handleReaction(emoji: string) {
    await toggleReaction(workspaceId, spaceId, comment.id, emoji);
    onRefresh();
  }

  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      // Rich copy (text + html + images) when the browser supports it,
      // otherwise plain text with image URLs — see lib/comment-clipboard.ts.
      await copyCommentToClipboard(
        buildCommentClipboardContent(
          comment.body,
          comment.attachments,
          window.location.origin
        ),
        browserClipboardEnv()
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy comment");
    }
  }

  const thumbsUpReaction = comment.reactions.find((r) => r.emoji === "👍");
  const hasThumbsUp =
    thumbsUpReaction?.userIds.includes(currentUserId) ?? false;

  // "You and Jane reacted" — resolve reactor ids to names so a hover reveals who
  // reacted when several people pile onto the same emoji. The emoji itself is
  // shown separately in the tooltip, so it's not repeated in this sentence.
  function reactorSentence(userIds: string[]): string {
    const names = userIds
      .map((uid) =>
        uid === currentUserId
          ? "You"
          : members.find((m) => m.id === uid)?.name?.trim() || "Someone"
      )
      // Show "You" first.
      .sort((a, b) => (a === "You" ? -1 : b === "You" ? 1 : 0));

    let who: string;
    if (names.length === 0) {
      who = "Someone";
    } else if (names.length === 1) {
      who = names[0];
    } else if (names.length === 2) {
      who = `${names[0]} and ${names[1]}`;
    } else if (names.length <= 4) {
      who = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    } else {
      who = `${names.slice(0, 3).join(", ")} and ${names.length - 3} others`;
    }

    return `${who} reacted`;
  }

  return (
    <div className={cn("group/comment", depth > 0 && "ml-6 mt-2")}>
      {/* Comment card */}
      <div
        className={cn(
          "rounded-xl border bg-elevated transition-colors",
          comment.isResolved && "opacity-60",
          depth > 0 && "border-base-300/60"
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <Avatar className="size-7 shrink-0">
            {comment.authorImage && (
              <AvatarImage src={avatarSrc(comment.authorImage)} />
            )}
            <AvatarFallback className="text-2xs bg-primary/10 text-primary font-semibold">
              {initials(comment.authorName, comment.authorEmail)}
            </AvatarFallback>
          </Avatar>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold leading-none">
              {displayName}
            </span>
            <span
              className="text-2xs text-base-content/60"
              title={format(new Date(comment.createdAt), "PPpp")}
            >
              {formatDistanceToNow(new Date(comment.createdAt), {
                addSuffix: true,
              })}
            </span>
            {comment.editedAt && (
              <span className="text-2xs text-base-content/60 italic">
                (edited)
              </span>
            )}
            {comment.isResolved && (
              <span className="text-2xs text-green-600 font-medium flex items-center gap-0.5">
                <CheckCircleIcon className="size-3" weight="fill" /> Resolved
              </span>
            )}
          </div>

          {/* Options menu — visible on hover */}
          <div className="opacity-0 group-hover/comment:opacity-100 flex items-center gap-0.5 transition-opacity shrink-0">
            {canResolve && depth === 0 && (
              <button
                className="size-6 flex items-center justify-center rounded hover:bg-base-200 text-base-content/60 hover:text-base-content"
                onClick={handleResolve}
                title={comment.isResolved ? "Unresolve" : "Resolve"}
                type="button"
              >
                {comment.isResolved ? (
                  <XCircleIcon className="size-3.5" />
                ) : (
                  <CheckCircleIcon className="size-3.5" />
                )}
              </button>
            )}
            {isAuthor && !comment.isDeleted && (
              <button
                className="size-6 flex items-center justify-center rounded hover:bg-base-200 text-base-content/60 hover:text-base-content"
                onClick={() => setEditing((v) => !v)}
                type="button"
              >
                <PencilSimpleIcon className="size-3.5" />
              </button>
            )}
            {canDelete && (
              <>
                <button
                  className="size-6 flex items-center justify-center rounded hover:bg-error/10 text-base-content/60 hover:text-error"
                  onClick={() => setDeleteOpen(true)}
                  type="button"
                >
                  <TrashIcon className="size-3.5" />
                </button>
                <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete comment?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This comment will be permanently deleted and cannot be
                        recovered.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-error text-error-content hover:bg-error/90"
                        onClick={() => void handleDelete()}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="px-3 pb-1">
          {comment.isDeleted ? (
            <p className="text-sm italic text-base-content/60 py-1">
              [Comment deleted]
            </p>
          ) : editing ? (
            <CommentEditor
              autoFocus
              compact
              initialContent={comment.body}
              members={members}
              onCancel={() => setEditing(false)}
              onSubmit={handleEdit}
              taskId={taskId}
            />
          ) : (
            <CommentBody body={comment.body} />
          )}
        </div>

        {/* Attachments */}
        {!comment.isDeleted && comment.attachments.length > 0 && (
          <CommentAttachments attachments={comment.attachments} />
        )}

        {/* Footer */}
        {!comment.isDeleted && (
          <TooltipProvider delayDuration={200}>
            <div className="flex flex-wrap items-center gap-1 px-3 pb-2 pt-1 border-t border-base-300/40">
              {/* Existing emoji reactions (👍 is shown on the dedicated like button) */}
              {comment.reactions
                .filter((r) => r.emoji !== "👍")
                .map((r) => {
                  const reacted = r.userIds.includes(currentUserId);
                  return (
                    <Tooltip key={r.emoji}>
                      <TooltipTrigger asChild>
                        <button
                          className={cn(
                            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                            reacted
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-base-300 hover:bg-base-200"
                          )}
                          onClick={() => handleReaction(r.emoji)}
                          type="button"
                        >
                          <span>{r.emoji}</span>
                          <span className="font-medium">{r.count}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        className="max-w-[220px] text-center"
                        side="top"
                      >
                        <span className="mb-0.5 block text-base leading-none">
                          {r.emoji}
                        </span>
                        {reactorSentence(r.userIds)}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}

              {/* Thumbs up quick reaction (the only thumbs-up shown) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Like"
                    className={cn(
                      "h-7 flex items-center justify-center gap-1 rounded-md border px-2 transition-colors",
                      hasThumbsUp
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-base-300 hover:bg-base-200 text-base-content/60 hover:text-base-content"
                    )}
                    onClick={() => handleReaction("👍")}
                    type="button"
                  >
                    <ThumbsUpIcon
                      className="size-3.5"
                      weight={hasThumbsUp ? "fill" : "regular"}
                    />
                    {(thumbsUpReaction?.count ?? 0) > 0 && (
                      <span className="text-xs font-medium">
                        {thumbsUpReaction?.count}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  className="max-w-[220px] text-center"
                  side="top"
                >
                  {(thumbsUpReaction?.count ?? 0) > 0 ? (
                    <>
                      <span className="mb-0.5 block text-base leading-none">
                        👍
                      </span>
                      {reactorSentence(thumbsUpReaction?.userIds ?? [])}
                    </>
                  ) : (
                    "Like"
                  )}
                </TooltipContent>
              </Tooltip>

              {/* Copy comment text */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Copy comment"
                    className="size-7 flex items-center justify-center rounded-md border border-base-300 hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors"
                    onClick={handleCopy}
                    type="button"
                  >
                    {copied ? (
                      <CheckIcon className="size-3.5 text-success" />
                    ) : (
                      <CopyIcon className="size-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {copied ? "Copied" : "Copy"}
                </TooltipContent>
              </Tooltip>

              {/* Emoji picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="size-7 flex items-center justify-center rounded-md border border-base-300 hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors"
                    type="button"
                  >
                    <SmileyIcon className="size-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-auto max-w-[calc(100vw-2rem)] overflow-x-auto p-0 border-0 shadow-lg"
                >
                  <EmojiPicker
                    data={loadEmojiData}
                    maxFrequentRows={2}
                    onEmojiSelect={(e: { native: string }) =>
                      handleReaction(e.native)
                    }
                    perLine={8}
                    previewPosition="none"
                    skinTonePosition="none"
                    theme={
                      typeof document !== "undefined" &&
                      document.documentElement.classList.contains("dark")
                        ? "dark"
                        : "light"
                    }
                  />
                </PopoverContent>
              </Popover>

              <div className="flex-1" />

              {/* Reply */}
              {depth === 0 && (
                <button
                  className="text-xs font-medium text-base-content/60 hover:text-base-content transition-colors px-1"
                  onClick={() => setReplying((v) => !v)}
                  type="button"
                >
                  Reply
                </button>
              )}
            </div>
          </TooltipProvider>
        )}
      </div>

      {/* Reply editor */}
      {replying && (
        <div className="mt-2 ml-4">
          <CommentEditor
            autoFocus
            compact
            members={members}
            onCancel={() => setReplying(false)}
            onSubmit={handleReply}
            placeholder="Write a reply…"
            taskId={taskId}
          />
        </div>
      )}

      {/* Replies */}
      {comment.replies.length > 0 && (
        <div className="mt-2">
          <button
            className="flex items-center gap-1 text-xs text-base-content/60 hover:text-base-content ml-3 mb-2 transition-colors"
            onClick={() => setRepliesOpen((v) => !v)}
            type="button"
          >
            {repliesOpen ? (
              <CaretDownIcon className="size-3" />
            ) : (
              <CaretRightIcon className="size-3" />
            )}
            {comment.replies.length}{" "}
            {comment.replies.length === 1 ? "reply" : "replies"}
          </button>
          {repliesOpen && (
            <div className="space-y-2">
              {comment.replies.map((reply) => (
                <CommentItem
                  comment={reply}
                  currentUserId={currentUserId}
                  depth={depth + 1}
                  isAdmin={isAdmin}
                  key={reply.id}
                  listId={listId}
                  members={members}
                  onRefresh={onRefresh}
                  spaceId={spaceId}
                  taskId={taskId}
                  workspaceId={workspaceId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Activity row ─────────────────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const meta = entry.meta as Record<string, unknown>;
  const timeNote =
    entry.eventType === "time_logged"
      ? (meta.note as string | null | undefined)
      : null;

  return (
    <div className="flex items-center gap-2 py-1 px-1">
      <Avatar className="size-6 shrink-0 md:size-5">
        {entry.image && <AvatarImage src={avatarSrc(entry.image)} />}
        <AvatarFallback className="text-[9px] bg-base-200">
          {initials(entry.name, entry.email)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0 text-xs text-base-content/60">
        <div>
          <span className="font-medium text-base-content">
            {entry.name ?? entry.email ?? "System"}
          </span>{" "}
          {describeEvent(entry.eventType, meta)}
          {/* Own line below `md:` for a clearer User/Action/Timestamp split
            on narrow phones; inline (unchanged) at `md:`+. */}
          <span
            className="mt-0.5 block text-2xs opacity-70 md:ml-2 md:mt-0 md:inline"
            title={format(new Date(entry.createdAt), "PPpp")}
          >
            {formatDistanceToNow(new Date(entry.createdAt), {
              addSuffix: true,
            })}
          </span>
        </div>
        {timeNote && (
          <p className="mt-0.5 text-2xs text-base-content/80 italic truncate">
            &ldquo;{timeNote}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main feed ────────────────────────────────────────────────────────────────

export const TaskActivityFeed = function TaskActivityFeed({
  workspaceId,
  spaceId,
  listId,
  taskId,
  currentUserId,
  isAdmin,
  hideHeader,
  variant = "inline",
  ref,
}: TaskActivityFeedProps & {
  ref?: React.RefObject<TaskActivityFeedHandle | null>;
}) {
  const [comments, setComments] = React.useState<CommentWithReplies[]>([]);
  const [activityLogs, setActivityLogs] = React.useState<ActivityEntry[]>([]);
  const [members, setMembers] = React.useState<MentionMember[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    const [commentsRes, activityRes, membersRes] = await Promise.all([
      getTaskComments(workspaceId, spaceId, taskId),
      getTaskActivity(workspaceId, spaceId, taskId),
      getWorkspaceMentionMembers(workspaceId, spaceId),
    ]);
    if (!("error" in commentsRes)) {
      setComments(commentsRes.comments);
    }
    if (!("error" in activityRes)) {
      setActivityLogs(activityRes.logs as ActivityEntry[]);
    }
    if (Array.isArray(membersRes)) {
      setMembers(membersRes);
    }
    setLoading(false);
  }, [workspaceId, spaceId, taskId]);

  React.useImperativeHandle(
    ref,
    () => ({
      refresh: () => {
        void load();
      },
    }),
    [load]
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  // Live updates: refetch comments + activity when THIS task changes elsewhere.
  // Events for other tasks are ignored; events without a taskId refetch (safe
  // default). The composer's text is local editor state, so a refetch never
  // clears a half-typed comment (and the provider defers while it's focused).
  useRealtimeRefetch((meta) => {
    if (meta?.taskId && meta.taskId !== taskId) {
      return;
    }
    void load();
  });

  const feed: FeedItem[] = React.useMemo(() => {
    const items: FeedItem[] = [
      ...comments.map(
        (c): FeedItem => ({
          type: "comment",
          createdAt: new Date(c.createdAt),
          comment: c,
        })
      ),
      ...activityLogs
        .filter((a) => a.eventType !== "comment_added")
        .map(
          (a): FeedItem => ({
            type: "activity",
            createdAt: new Date(a.createdAt),
            activity: a,
          })
        ),
    ];
    items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return items;
  }, [comments, activityLogs]);

  async function handleNewComment(body: unknown, files: File[]) {
    const res = await createComment(workspaceId, spaceId, listId, taskId, body);
    if (files.length > 0 && "commentId" in res) {
      await Promise.all(
        files.map((file) => {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("commentId", res.commentId);
          return fetch(`/api/tasks/${taskId}/attachments`, {
            method: "POST",
            body: fd,
          });
        })
      );
    }
    void load();
  }

  const header = hideHeader ? null : (
    <p className="text-xs font-semibold text-base-content/60 uppercase tracking-wide">
      Activity
    </p>
  );

  const body = loading ? (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div className="flex gap-2" key={i}>
          <div className="size-7 rounded-full bg-base-200 shrink-0" />
          <div className="flex-1 h-20 rounded-xl bg-base-200" />
        </div>
      ))}
    </div>
  ) : (
    <div className="space-y-2">
      {feed.map((item) =>
        item.type === "comment" && item.comment ? (
          <CommentItem
            comment={item.comment}
            currentUserId={currentUserId}
            depth={0}
            isAdmin={isAdmin}
            key={`c-${item.comment.id}`}
            listId={listId}
            members={members}
            onRefresh={load}
            spaceId={spaceId}
            taskId={taskId}
            workspaceId={workspaceId}
          />
        ) : item.activity ? (
          <ActivityRow entry={item.activity} key={`a-${item.activity.id}`} />
        ) : null
      )}
      {feed.length === 0 && (
        <p className="text-xs text-base-content/60 py-2">No activity yet.</p>
      )}
    </div>
  );

  const composer = (
    <CommentEditor
      enableAttachments
      members={members}
      onSubmit={handleNewComment}
      placeholder="Add a comment… Type '/' for commands"
      taskId={taskId}
    />
  );

  // Full task page: the feed is the whole right column, so the activity list
  // takes the remaining height and scrolls while the composer is a fixed
  // footer. `min-h-0` on both is what lets the list actually shrink.
  if (variant === "fill") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-3 py-4 sm:px-5">
          {header}
          {body}
        </div>
        <div className="shrink-0 border-t bg-base-100 px-3 py-3 sm:px-5">
          {composer}
        </div>
      </div>
    );
  }

  // Drawer: the feed is the last section of a taller scroll column it doesn't
  // own, so the composer sticks to the bottom of that scrollport instead. The
  // negative margin lets its background bleed over the column's padding —
  // matches the parent's own responsive px-4/sm:px-6 (task-detail-panel.tsx).
  return (
    <div className="space-y-3">
      {header}
      {body}
      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-base-100 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-6">
        {composer}
      </div>
    </div>
  );
};

TaskActivityFeed.displayName = "TaskActivityFeed";
