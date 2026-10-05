import { describe, expect, it } from "vitest";
import {
  normalizePgConnectionString,
  sanitizeDatabaseUrl,
} from "@/lib/pg-connection";

describe("normalizePgConnectionString", () => {
  it("rewrites the postgres:// alias to postgresql://", () => {
    expect(
      normalizePgConnectionString("postgres://user:pass@host:5432/db")
    ).toBe("postgresql://user:pass@host:5432/db");
  });

  it("leaves an already-canonical postgresql:// URL unchanged", () => {
    const url = "postgresql://user:pass@host:5432/db";
    expect(normalizePgConnectionString(url)).toBe(url);
  });

  it("only rewrites at the start of the string, not scheme-lookalikes elsewhere", () => {
    expect(
      normalizePgConnectionString("http://example.com?x=postgres://y")
    ).toBe("http://example.com?x=postgres://y");
  });
});

describe("sanitizeDatabaseUrl", () => {
  it("returns a no-param URL unchanged with ssl:false, prepare:true", () => {
    const result = sanitizeDatabaseUrl(
      "postgresql://user:pass@localhost:5432/mydb"
    );
    expect(result).toEqual({
      url: "postgresql://user:pass@localhost:5432/mydb",
      ssl: false,
      prepare: true,
    });
  });

  it("normalizes the postgres:// alias before sanitizing", () => {
    const result = sanitizeDatabaseUrl(
      "postgres://user:pass@localhost:5432/mydb"
    );
    expect(result.url).toBe("postgresql://user:pass@localhost:5432/mydb");
  });

  describe("sslmode mapping", () => {
    it.each([
      ["disable", false],
      ["", false],
    ] as const)("sslmode=%s -> ssl:%s", (mode, expected) => {
      const result = sanitizeDatabaseUrl(
        `postgresql://u:p@h/db?sslmode=${mode}`
      );
      expect(result.ssl).toBe(expected);
    });

    it.each(["allow", "prefer", "require", "no-verify"])(
      "sslmode=%s -> encrypt without verification",
      (mode) => {
        const result = sanitizeDatabaseUrl(
          `postgresql://u:p@h/db?sslmode=${mode}`
        );
        expect(result.ssl).toEqual({ rejectUnauthorized: false });
      }
    );

    it.each(["verify-ca", "verify-full"])(
      "sslmode=%s -> encrypt and verify",
      (mode) => {
        const result = sanitizeDatabaseUrl(
          `postgresql://u:p@h/db?sslmode=${mode}`
        );
        expect(result.ssl).toBe(true);
      }
    );

    it("treats an absent sslmode as no TLS (bundled-Postgres default)", () => {
      const result = sanitizeDatabaseUrl("postgresql://u:p@h/db");
      expect(result.ssl).toBe(false);
    });

    it("defaults an unknown sslmode to encrypt-without-verification, not plaintext", () => {
      const result = sanitizeDatabaseUrl(
        "postgresql://u:p@h/db?sslmode=totally-bogus"
      );
      expect(result.ssl).toEqual({ rejectUnauthorized: false });
    });
  });

  describe("pgbouncer mapping", () => {
    it("disables prepared statements when pgbouncer=true", () => {
      const result = sanitizeDatabaseUrl(
        "postgresql://u:p@h/db?pgbouncer=true"
      );
      expect(result.prepare).toBe(false);
    });

    it("keeps prepared statements enabled when pgbouncer=false", () => {
      const result = sanitizeDatabaseUrl(
        "postgresql://u:p@h/db?pgbouncer=false"
      );
      expect(result.prepare).toBe(true);
    });

    it("keeps prepared statements enabled when pgbouncer is absent", () => {
      const result = sanitizeDatabaseUrl("postgresql://u:p@h/db");
      expect(result.prepare).toBe(true);
    });
  });

  describe("client-only parameter stripping", () => {
    it("strips sslmode, channel_binding, and pgbouncer from the output URL", () => {
      const result = sanitizeDatabaseUrl(
        "postgresql://u:p@h/db?sslmode=require&channel_binding=require&pgbouncer=true"
      );
      expect(result.url).not.toContain("sslmode");
      expect(result.url).not.toContain("channel_binding");
      expect(result.url).not.toContain("pgbouncer");
      expect(result.url).toBe("postgresql://u:p@h/db");
    });

    it("strips sslcert/sslkey/sslrootcert/sslpassword/uselibpqcompat", () => {
      const result = sanitizeDatabaseUrl(
        "postgresql://u:p@h/db?sslcert=a&sslkey=b&sslrootcert=c&sslpassword=d&uselibpqcompat=true"
      );
      expect(result.url).toBe("postgresql://u:p@h/db");
    });

    it("retains genuine driver/startup parameters like application_name", () => {
      const result = sanitizeDatabaseUrl(
        "postgresql://u:p@h/db?sslmode=require&application_name=kanbanica"
      );
      expect(result.url).toBe(
        "postgresql://u:p@h/db?application_name=kanbanica"
      );
    });
  });

  describe("unparseable connection strings", () => {
    it("falls back to the raw string with ssl:false, prepare:true rather than throwing", () => {
      const result = sanitizeDatabaseUrl("host=localhost dbname=test user=me");
      expect(result).toEqual({
        url: "host=localhost dbname=test user=me",
        ssl: false,
        prepare: true,
      });
    });
  });
});
