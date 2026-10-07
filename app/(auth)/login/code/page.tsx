import Link from "next/link";
import { redirect } from "next/navigation";
import { PRODUCT_NAME } from "@/config/platform";
import { getCurrentSession } from "@/lib/authz";
import { getFallbackCode } from "@/lib/login-fallback";
import { AuthShell } from "../../_components/auth-shell";
import { FallbackCode } from "./fallback-code";

// The URL carries the (already-emailed) magic-link token; don't leak it via
// the Referer header or search indexes.
export const metadata = {
  title: `Verification code — ${PRODUCT_NAME}`,
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function LoginCodeFallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (await getCurrentSession()) {
    redirect("/post-auth");
  }
  const { token = "" } = await searchParams;
  const result = await getFallbackCode(token);

  if (!result.ok) {
    return (
      <AuthShell
        description={
          result.reason === "superseded"
            ? "A newer sign-in email was sent, so this code no longer works. Use the latest email, or request a new one."
            : "This sign-in link is invalid or has expired. Request a new one."
        }
        title="Link no longer valid"
      >
        <Link
          className="text-primary text-sm underline underline-offset-4"
          href="/login"
        >
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      description="Enter this verification code where you first tried to sign in."
      title="Use verification code to continue"
    >
      <FallbackCode code={result.code} token={token} />
    </AuthShell>
  );
}
