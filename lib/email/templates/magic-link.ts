import { createElement } from "react";
import { PRODUCT_NAME } from "@/config/platform";
import { MagicLinkEmail } from "@/lib/email/components/magic-link";
import { renderEmailTemplate } from "@/lib/email/renderer";

export async function magicLinkTemplate({
  email,
  magicLinkUrl,
}: {
  email: string;
  magicLinkUrl: string;
}) {
  const html = await renderEmailTemplate(
    createElement(MagicLinkEmail, {
      email,
      magicLinkUrl,
      productName: PRODUCT_NAME,
    })
  );

  const text = `Sign in to ${PRODUCT_NAME}

Use this link to sign in as ${email}:
${magicLinkUrl}

If you did not request this email, you can safely ignore it.`;

  return { html, text };
}
