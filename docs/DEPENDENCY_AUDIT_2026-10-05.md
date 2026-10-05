# Dependency Audit — 2026-10-05

Node 22.15 (Docker `node:22`), pnpm 11.6.0, single package (no monorepo). 56 direct deps + 20 dev deps = 76 checked. Nothing committed or pushed.

## Updated (in-range, no `--latest`, no overrides)

| Package | Before | After | Reason | Risk |
|---|---|---|---|---|
| next | 16.3.0 | 16.3.8 | 2 critical advisories (fixed ≥16.3.6) | Low (patch) |
| sharp | 0.35.3 | 0.35.5 | high advisory (fixed ≥0.35.4) | Low |
| @tiptap/* (11 pkgs) | 3.30.1 | 3.31.4 | high + moderate advisories (≥3.30.5) | Low–med (editor; same 3.x line) |
| vitest | 4.1.10 | 4.1.11 | moderate advisory | Low (dev) |
| nodemailer | 9.0.5 | 9.1.1 | fixes the <9.1.0 advisories | Low (minor) |
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.10 | 0.45.3 / 0.31.11 | patch | Low |
| @aws-sdk/client-s3, s3-presigned-post, s3-request-presigner | 3.1109.0 | 3.1146.0 | rolling SDK releases, kept in lockstep | Low |
| react-day-picker | 10.0.1 | 10.0.2 | patch | Low |
| tsx, concurrently, postcss, @types/nodemailer | — | 4.23.15, 10.0.5, 8.5.28, 8.0.2 | patch | Low |
| Transitives (lockfile only): fast-uri 3.1.8, ip-address 10.7.3, hono 4.13.13, qs 6.16.0, brace-expansion 5.0.12, engine.io 6.6.11, prosemirror-model/view 1.25.12 / 1.42.6 | — | — | advisories; in-range re-resolution | Low |

Lockfile churn was reviewed package-by-package: every changed entry is a dependency of one of the above. `prosemirror-model` briefly resolved to two versions after the Tiptap bump; unified to 1.25.12 with `pnpm update prosemirror-model` (duplicate instances break ProseMirror).

## Held back — REVIEW BEFORE UPDATE (in range, but touch UI/auth/storage/lint)

| Package | Current → Latest | Why held |
|---|---|---|
| react, react-dom, @types/react, @types/react-dom | 19.2.8 → 19.3.0 | Core framework minor; needs full browser QA |
| better-auth | 1.6.27 → 1.7.7 | Auth, 0.x-style minor jumps can change behavior |
| files-sdk | 2.2.4 → 2.6.2 | Storage layer, 4 minors; also source of most transitive advisories |
| pg-boss | 12.27 → 12.36 | Job queue; requires Node ≥22.12 (ok today) — test worker first |
| zod | 4.4.3 → 4.6.5 | Used across forms/env validation |
| react-hook-form, @hookform/resolvers | 7.85→7.89, 5.7→5.9 | Auth forms |
| tailwind-merge | 3.6.0 → 3.7.0 | Changes class merging → possible silent UI diffs |
| daisyui | 5.7.16 → 5.7.47 | 31 patch releases of CSS; UI risk |
| framer-motion | 13.1.0 → 13.5.1 | Landing page only |
| react-email | 6.9.2 → 6.11.0 | Email templates/preview tooling |
| @biomejs/biome, ultracite | 2.5.8 → 2.5.15, 7.8.3 → 7.12.2 | New lint rules would change `pnpm lint` results |
| @types/node | 26.2.0 → 26.6.4 | Type-only; low risk, simply not needed |

## MAJOR / BREAKING (not done)

| Package | Current → Latest | Notes |
|---|---|---|
| nodemailer | 9.x → 10.0.14 | **Only fix for the remaining high advisories** (≥10.0.6). Node ≥20 OK. Check SMTP options/API in `lib/smtp/client.ts`, then run `smtp/client.test.ts`. Recommended next. |
| vitest | 4.1.11 → 5.0.3 | Needs Node ≥22.12 (ok); dev-only; no security need |
| framer-motion | 13 → 14.0.0 | Landing page only |

No alpha/beta/rc/canary versions were considered; all "latest" values are npm `latest` dist-tags.

## Unused dependencies

- **Definitely unused:** none.
- **Possibly unused (keep):**
  - `@aws-sdk/s3-presigned-post` — no direct import, but it is an optional peer of `files-sdk`'s S3 adapter. Keep unless presigned-POST uploads are confirmed unused.
  - `@tiptap/pm` — no direct import, but a required peer of the Tiptap packages.
  - `tsx`, `concurrently`, `ultracite`, `postcss`, `@biomejs/biome`, `@types/*` — used via scripts, `biome.jsonc` extends, `postcss.config.mjs`, and TypeScript.
- **Redundancy:** none significant. `@headlessui/react` + `@floating-ui/dom` + hand-rolled primitives overlap, but that is a deliberate design decision per CLAUDE.md. `postcss` has two versions (8.5.23 pulled in by Next, 8.5.28 direct) — harmless.

## Security

`pnpm audit`: **36 → 6** (3 critical, 12 high, 21 moderate → 0 critical, 2 high, 4 moderate). None were fixed via `audit --fix` or overrides.

Remaining:
- nodemailer (direct): 2 high + 3 moderate, patched only in ≥10.0.6/10.0.9 (major, see above). 9.1.1 is still better than 9.0.5.
- esbuild ≤0.24.2 via `@esbuild-kit/*` inside drizzle-kit (dev tooling only; dev-server request issue, not in the production runtime). Cleared when drizzle-kit drops the legacy loader.

## Regression

| Check | Before | After |
|---|---|---|
| `pnpm typecheck` (no `pnpm check` script exists) | pass | pass |
| `pnpm test` | 607/607 | 607/607 |
| `pnpm lint` | 5 errors | the same 5 errors (pre-existing format/import-order in 3 test files + `scripts/sync-readme.mjs`; untouched) |
| `pnpm lint:tokens` | clean (`bash scripts/lint-tokens.sh`; the file isn't executable, so `pnpm lint:tokens` fails with exit 126 — pre-existing) | clean |
| `pnpm docs:check` | in sync | in sync |
| `pnpm build` | — | pass |
| Smoke (`pnpm start` + curl, no errors in log) | — | /login 200, /privacy 200, /api/auth/get-session 200, /dashboard & / redirect to /login, CSS assets linked; sharp resize→WebP works |

**Browser QA / UI verification: not done.** The repo has no browser test suite and I can't drive a browser here. Auth, dashboard, board/list/calendar/sprint, drag-and-drop, modals and mobile layouts were **not** visually verified. The riskiest touched area is the Tiptap editor (description + comment composer): do a manual pass there (typing, `/` menu, @mentions, links, task lists, paste) before deploying. DB-backed behavior was only covered by the unit tests.

## Recommendation

**SAFE, BUT REVIEW THESE MAJOR UPDATES BEFORE NEXT MAINTENANCE CYCLE** — nodemailer 10 (resolves remaining high advisories), plus the held-back React 19.3 / better-auth 1.7 / files-sdk 2.6 group. Merge only after the manual Tiptap/UI pass above.
