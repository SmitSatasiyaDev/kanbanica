# Solution: serve risky files as downloads and sandbox the rest

**What changed** (`app/api/files/[...key]/route.ts`)
- Every file response sends `X-Content-Type-Options: nosniff`.
- Only png, jpg, jpeg, gif, webp, pdf and txt are served with
  `Content-Disposition: inline`. Everything else (SVG, csv, zip, office files,
  unknown types) is sent as `attachment`, so it downloads instead of rendering.
- Every response except PDF also sends
  `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'`,
  so even a file that does render cannot run scripts or reach the app's origin.
  PDFs are excluded because Chrome's PDF viewer will not load under a `sandbox`
  policy; they still get nosniff and inline.
- The filename in `Content-Disposition` is taken from the last key segment with
  quotes, `\r`, `\n` and backslashes removed, and an RFC 5987 `filename*` value is
  added.

**Tests:** `app/api/files/[...key]/route.test.ts`.

**Why it works:** Opening an SVG URL now downloads it. If it is ever rendered, the
sandbox policy gives it an opaque origin with scripts disabled. SVGs embedded with
`<img src>` still display, because images never run scripts and ignore
`Content-Disposition`.

**Out of scope:** With S3/R2 storage, files served from the bucket's own URL come
from a different origin than the app, so the same-origin script problem does not
apply there. Those bucket URLs are also not access-checked by this route.
