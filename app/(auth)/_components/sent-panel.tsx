"use client";

import { CheckCircleIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { SignInCodeForm } from "./sign-in-code-form";

const linkButton =
  "underline underline-offset-4 hover:text-base-content transition-colors disabled:opacity-60";

/**
 * "Check your inbox" → optional dedicated verification-code screen.
 *
 * The emailed message already carries both the sign-in link and the code, so
 * opening the code screen sends nothing; only "Resend email" does.
 */
export function SentPanel({
  email,
  onTryAgain,
  onResend,
  onDifferentEmail,
}: {
  email: string;
  /** Back to the email form (existing "Try again" behaviour). */
  onTryAgain: () => void;
  /** Sends a fresh email; resolves to an error message, or null on success. */
  onResend: () => Promise<string | null>;
  onDifferentEmail: () => void;
}) {
  const [showCode, setShowCode] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  async function resend() {
    setResending(true);
    setResendError(null);
    const error = await onResend();
    setResending(false);
    if (error) {
      setResendError(error);
      return;
    }
    // New email = new code: clear whatever was typed for the old one.
    setFormKey((k) => k + 1);
  }

  const emailLabel = (
    <span className="font-semibold text-base-content">{email}</span>
  );

  if (showCode) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheckIcon className="size-6 text-primary" weight="duotone" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight text-base-content">
            Verify your email
          </h2>
          <p className="text-sm leading-relaxed text-base-content/70">
            Enter the 6-digit verification code we sent to {emailLabel}.
          </p>
        </div>
        <SignInCodeForm email={email} key={formKey} />
        <div className="space-y-1 text-base-content/60 text-xs">
          {resendError && (
            <p className="text-error" role="alert">
              {resendError}
            </p>
          )}
          <p>
            {"Didn't receive the code? "}
            <button
              className={linkButton}
              disabled={resending}
              onClick={resend}
              type="button"
            >
              {resending ? "Sending…" : "Resend email"}
            </button>
          </p>
          <p>
            <button
              className={linkButton}
              onClick={onDifferentEmail}
              type="button"
            >
              Use a different email
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <CheckCircleIcon className="size-6 text-primary" weight="duotone" />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-base-content">
          Check your inbox
        </h2>
        <p className="text-sm leading-relaxed text-base-content/70">
          We sent a sign-in link to {emailLabel}.
        </p>
      </div>
      <button
        className="text-primary text-sm font-medium underline underline-offset-4 hover:opacity-80 transition-opacity"
        onClick={() => setShowCode(true)}
        type="button"
      >
        Enter verification code
      </button>
      <p className="text-base-content/60 text-xs">
        {"Didn't receive the email? "}
        <button className={linkButton} onClick={onTryAgain} type="button">
          Try again
        </button>
      </p>
    </div>
  );
}
