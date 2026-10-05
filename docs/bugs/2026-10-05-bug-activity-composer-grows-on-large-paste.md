# Activity comment composer grows unbounded on large paste

**Symptom:** pasting a large amount of text into the Activity comment composer made the editor expand without limit. The toolbar with the Send button was pushed out of view / the composer broke its layout until the comment was sent.

**Where:** `CommentEditor` in `components/task/task-activity-feed.tsx` (full task page footer and drawer sticky footer).

**Root cause:** the Tiptap editor element only had `min-h-[72px]` / `min-h-[44px]` — no max height and no overflow. Its height followed content, so the footer (`shrink-0` on the full page, `sticky bottom-0` in the drawer) grew taller than the available space and pushed the toolbar/Send out.
