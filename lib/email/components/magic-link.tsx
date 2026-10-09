import { Button, Link, Section, Text } from "react-email";
import { PRODUCT_NAME } from "@/config/platform";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export function MagicLinkEmail({
  email,
  magicLinkUrl,
  productName = PRODUCT_NAME,
}: {
  email: string;
  magicLinkUrl: string;
  productName?: string;
}) {
  return (
    <EmailLayout
      preview={`Sign in to ${productName}`}
      productName={productName}
    >
      <Text style={emailStyles.heading}>Sign in to {productName}</Text>
      <Text style={emailStyles.paragraph}>
        Use the button below to sign in as{" "}
        <strong style={{ color: "#174D38" }}>{email}</strong>.
      </Text>
      <Section style={{ margin: "24px 0" }}>
        <Button href={magicLinkUrl} style={emailStyles.button}>
          Sign In
        </Button>
      </Section>
      <Text style={emailStyles.muted}>
        This link expires shortly and can only be used once.
      </Text>
      <Text style={emailStyles.fallbackLink}>
        If the button does not work, paste this link into your browser:{" "}
        <Link href={magicLinkUrl} style={emailStyles.link}>
          {magicLinkUrl}
        </Link>
      </Text>
      <Text style={emailStyles.muted}>
        If you didn&apos;t request this email, you can safely ignore it.
      </Text>
    </EmailLayout>
  );
}
