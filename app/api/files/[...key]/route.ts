import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canReadStoredFile } from "@/lib/file-access";
import { storage } from "@/lib/storage";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  // Office documents
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// Only these types are shown in the browser. Anything else (SVG, HTML-like or
// unknown types) is downloaded, so uploaded markup never runs on the app origin.
const INLINE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "pdf",
  "txt",
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key: keyParts } = await params;
  const key = keyParts.join("/");

  // A denied file looks the same as a missing one, so a caller cannot probe
  // which keys exist.
  if (!(await canReadStoredFile(session.user.id, key))) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const blob = await storage.download(key);
    if (!blob) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    const disposition = INLINE_EXTENSIONS.has(ext) ? "inline" : "attachment";

    const rawName = keyParts[keyParts.length - 1] ?? "file";
    const fileName = rawName.replace(/["\r\n\\]/g, "");

    const responseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
      // Access depends on who is signed in. Without this, the browser cache
      // can hand one account's file to the next account on the same browser.
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${disposition}; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    };
    // The sandbox policy stops any script in the file from running with the
    // app's origin. PDFs are left out because Chrome's built-in PDF viewer
    // refuses to render under a sandbox policy.
    if (ext !== "pdf") {
      responseHeaders["Content-Security-Policy"] =
        "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";
    }

    const buffer = await blob.arrayBuffer();
    return new Response(buffer, { headers: responseHeaders });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
