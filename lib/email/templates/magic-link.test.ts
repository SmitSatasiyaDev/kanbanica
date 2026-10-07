import { describe, expect, it } from "vitest";
import { magicLinkTemplate } from "@/lib/email/templates/magic-link";

const url = "https://app.example.com/api/auth/magic-link/verify?token=abc";

describe("magicLinkTemplate", () => {
  it("contains the Sign In button and the magic-link URL", async () => {
    const { html, text } = await magicLinkTemplate({
      email: "a@b.com",
      magicLinkUrl: url,
    });
    expect(html).toContain("Sign In");
    expect(html).toContain(url);
    expect(text).toContain(url);
    expect(html).toContain("a@b.com");
  });

  it("does not mention or render a verification code", async () => {
    const { html, text } = await magicLinkTemplate({
      email: "a@b.com",
      magicLinkUrl: url,
    });
    for (const body of [html, text]) {
      expect(body.toLowerCase()).not.toContain("verification code");
      expect(body).not.toContain("This code expires in 10 minutes");
    }
  });
});
