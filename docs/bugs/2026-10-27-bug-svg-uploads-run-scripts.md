# Bug: uploaded SVG files run scripts on the app origin

**Symptom:** An SVG attachment containing a `<script>` tag executed JavaScript
when its `/api/files/...` URL was opened in the browser. The script ran with the
viewer's session and could call the app's own APIs.

**Where:** `app/api/files/[...key]/route.ts` (GET).

**Root cause:** The route set `Content-Type` from the key extension
(`image/svg+xml`), sent `Content-Disposition: inline`, and added no
`X-Content-Type-Options` or `Content-Security-Policy` header. Browsers render
SVG documents as active content, so the script ran on the app's origin.

**How it was reproduced:** Uploaded an SVG with a `<script>` to a task, then
opened the file URL directly. The script ran on the app origin, changed
`document.title`, read `document.cookie`, and a same-origin `fetch` to
`/api/tasks/<id>/attachments` from inside the SVG returned 200.
