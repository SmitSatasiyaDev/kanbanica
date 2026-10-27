import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, canReadMock, downloadMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  canReadMock: vi.fn(),
  downloadMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));
vi.mock("@/lib/file-access", () => ({ canReadStoredFile: canReadMock }));
vi.mock("@/lib/storage", () => ({ storage: { download: downloadMock } }));

import { GET } from "@/app/api/files/[...key]/route";

const CSP =
  "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

function call(...key: string[]) {
  return GET(new Request("http://x") as never, {
    params: Promise.resolve({ key }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "u1" } });
  canReadMock.mockResolvedValue(true);
  downloadMock.mockResolvedValue(new Blob(["data"]));
});

describe("GET /api/files/[...key]", () => {
  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await call("attachments", "w1", "t1", "a1", "f.png");
    expect(res.status).toBe(401);
    expect(canReadMock).not.toHaveBeenCalled();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("returns 404 and never downloads when access is denied", async () => {
    canReadMock.mockResolvedValue(false);
    const res = await call("attachments", "w1", "t1", "a1", "f.png");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "File not found" });
    expect(canReadMock).toHaveBeenCalledWith(
      "u1",
      "attachments/w1/t1/a1/f.png"
    );
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("serves a png inline with nosniff and a sandbox CSP", async () => {
    const res = await call("attachments", "w1", "t1", "a1", "f.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(res.headers.get("vary")).toBe("Cookie");
  });

  it("serves an svg as an attachment with a sandbox CSP", async () => {
    const res = await call("attachments", "w1", "t1", "a1", "x.svg");
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe(CSP);
  });

  it("serves a pdf inline without a CSP", async () => {
    const res = await call("attachments", "w1", "t1", "a1", "doc.pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("downloads unknown types as attachments", async () => {
    const res = await call("attachments", "w1", "t1", "a1", "data.bin");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("strips quotes, newlines and backslashes from the filename", async () => {
    const res = await call("attachments", "w1", "t1", "a1", 'a"b\\c\r\nd.png');
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain('filename="abcd.png"');
    expect(cd).toContain("filename*=UTF-8''abcd.png");
  });
});
