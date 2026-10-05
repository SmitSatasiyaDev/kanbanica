# DaisyUI 5.7.16 → 5.7.47 evaluation (2026-10-05)

**Result: SAFE TO UPGRADE.** Only `daisyui` changed (`package.json`: `^5.7.16` → `^5.7.47`; `pnpm-lock.yaml`: 3 DaisyUI entries, 10 changed lines).

## Setup
Node 22.15.0, pnpm 12.9.1, tailwindcss / @tailwindcss/postcss 4.3.3 (unchanged). DaisyUI is loaded in `app/globals.css` with `themes: false`, so none of its built-in colours apply. It supplies component CSS only. In app code, the daisy `btn` class appears only in `components/ui/button.tsx` and `components/landing-page.tsx`.

## Changelog risk (5.7.17 – 5.7.47: bug fixes only)
| Change | Applies to Kanbanica? |
|---|---|
| `.btn` styles `aria-pressed=true` / `aria-checked=true` / `aria-current` as active (5.7.38, 5.7.40) | Only if a `Button` carries those attributes. Existing `aria-pressed` elements (facet filter, emoji/colour pickers) are plain `<button>`s without `btn`. No effect found. |
| Disabled `input` / `select` / `textarea` styling (5.7.42), `btn-link` + disabled (5.7.47) | Covered by screenshots (disabled login submit etc.): no visible change. |
| `badge` and `loading` no longer shrink in flex (5.7.35, 5.7.36) | Intended to be neutral; badges already use `shrink-0`. |
| `.checkbox` / `.tooltip` / `.dropdown` / `.menu` / `.join` / `.breadcrumbs` / `.status` / `.range` / `.diff` / `.skeleton` RTL fixes | The app's checkbox, tooltip, dropdown and menu are hand-rolled primitives, so these selectors don't apply. |

Generated CSS: 318,388 → 323,520 bytes (+1.6%). Rule-level diff: 60 rules removed, 72 added, all inside DaisyUI component rules matching the notes above. Build time is unchanged (≈14–22 s).

## Verification
| Check | Baseline 5.7.16 | After 5.7.47 |
|---|---|---|
| typecheck | pass | pass |
| tests | 607/607 | 607/607 |
| lint | same 5 pre-existing errors | same 5 |
| build | pass | pass |
| `pnpm audit` | 6 (2 high, 4 moderate) | 6 (no change) |
| production start | /login 200, /privacy 200, /api/health 200, /dashboard → 307 /login | identical; CSS assets 200; no new log lines |

### Visual regression (headless Chrome, disposable DB, identical data state)
100 full-page/overlay screenshots at 390 / 768 / 1024 / 1280 / 1440 px (list, board, calendar, my tasks, overview, inbox, notification settings, members, limits, security, profile, task page, Tiptap `/` menu, create-task / sprint / list dialogs, filter / sort / user / workspace dropdowns, login, forgot-password, privacy, terms).
- **89 of 100 pixel-identical.**
- **Task page ×7:** differences are relative timestamps ("17 minutes ago" vs "13 minutes ago") only. Harmless.
- **Login and forgot-password ×4:** max channel delta 13. The same build compared with itself differs by the same amount (9,320 px vs 9,212 px), so this is render noise. Harmless.
- No horizontal overflow at any width; browser console / 5xx counts identical before and after (21 / 0).

### Functional pass on 5.7.47
Pass: modal open/close (Escape), create task, sort dropdown, drag-and-drop card between columns, Board/List/Calendar tabs, Tiptap description typing + multiline, comment post, switch toggle, limits page, workspace general settings. Login submit is disabled for invalid input. Zero page errors.

## Not verified
Email, S3/file upload, real production data and dark mode were not exercised. Dark mode was not part of the screenshot matrix.

## Notes
- `pnpm update daisyui` also rewrote unrelated peer-suffix/`picomatch` lockfile entries. They were reverted and the DaisyUI lines edited by hand, so the lockfile diff is DaisyUI-only.
- The console warning `[tiptap warn] Duplicate extension names found: ['link','underline']` appears identically before and after. It comes from `components/task/task-description-editor.tsx` (StarterKit plus separate Link/Underline). Not caused by this upgrade.
