"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { continueInThisBrowser } from "./actions";

/**
 * Shown when the magic link is opened in a browser that didn't request the
 * login. The code is rendered from the server response only — never put in a
 * URL, storage or logs.
 */
export function FallbackCode({ code, token }: { code: string; token: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="select-all rounded-xl border border-base-300 bg-base-200 px-6 py-4 font-mono text-3xl font-bold tracking-[0.4em] text-base-content">
        {code}
      </p>
      <Button
        className="h-11 w-full rounded-md gap-2"
        onClick={copy}
        type="button"
        variant="outline"
      >
        {status === "copied" ? (
          <CheckIcon className="size-4" />
        ) : (
          <CopyIcon className="size-4" />
        )}
        {status === "copied" ? "Code copied" : "Copy code"}
      </Button>
      <p aria-live="polite" className="min-h-4 text-base-content/60 text-xs">
        {status === "failed" && "Couldn't copy. Select the code above instead."}
      </p>
      <form action={continueInThisBrowser}>
        <input name="token" type="hidden" value={token} />
        <button
          className="text-base-content/60 text-xs underline underline-offset-4 transition-colors hover:text-base-content"
          type="submit"
        >
          Sign in here instead
        </button>
      </form>
    </div>
  );
}
