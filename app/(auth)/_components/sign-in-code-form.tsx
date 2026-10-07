"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { authClientErrorMessage } from "@/lib/auth-errors";
import {
  isValidCode,
  SIGN_IN_CODE_LENGTH,
  sanitizeCode,
} from "@/lib/otp-input";

/**
 * Code-entry half of the "Check your inbox" state. The same email carries a
 * magic link and this 6-digit code; a verified code creates the same Better
 * Auth session and continues through /post-auth like the link does.
 */
export function SignInCodeForm({ email }: { email: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function verify() {
    if (loading || !isValidCode(code)) {
      return;
    }
    setError(null);
    setLoading(true);
    const { error: authError } = await authClient.signIn.emailOtp({
      email,
      otp: code,
    });
    if (authError) {
      setLoading(false);
      setError(authClientErrorMessage(authError));
      return;
    }
    router.push("/post-auth");
    router.refresh();
  }

  return (
    <form
      className="flex w-full flex-col gap-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        verify();
      }}
    >
      <label className="text-sm text-base-content/70" htmlFor="sign-in-code">
        Enter the 6-digit code from the email
      </label>
      <Input
        aria-invalid={error ? true : undefined}
        autoComplete="one-time-code"
        className={`h-11 rounded-lg text-center font-medium text-base-content ${code ? "font-mono text-lg tracking-[0.4em]" : "text-sm tracking-normal"}`}
        disabled={loading}
        id="sign-in-code"
        inputMode="numeric"
        maxLength={SIGN_IN_CODE_LENGTH}
        onChange={(e) => {
          setCode(sanitizeCode(e.target.value));
          setError(null);
        }}
        onPaste={(e) => {
          e.preventDefault();
          setCode(sanitizeCode(e.clipboardData.getData("text")));
          setError(null);
        }}
        pattern="[0-9]*"
        placeholder="Enter 6-digit code"
        value={code}
      />
      {error && (
        <p className="text-error text-sm" role="alert">
          {error}
        </p>
      )}
      <Button
        className="h-11 w-full rounded-md"
        disabled={loading || !isValidCode(code)}
        type="submit"
      >
        {loading ? <Spinner className="size-4" /> : null}
        {loading ? "Verifying…" : "Verify code"}
      </Button>
    </form>
  );
}
