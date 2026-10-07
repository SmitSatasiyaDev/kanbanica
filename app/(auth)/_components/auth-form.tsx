"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  EnvelopeIcon,
  PaperPlaneTiltIcon,
  SignInIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { GoogleIcon } from "@/components/common/google-icon";
import { PasswordInput } from "@/components/common/password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import type { AuthMethods } from "@/lib/auth-config";
import { authClientErrorMessage, authErrorMessage } from "@/lib/auth-errors";
import { SentPanel } from "./sent-panel";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

// When password auth is off this component renders exactly as it always has:
// Google (if configured) + magic link. Nothing about that path changed.
const DEFAULT_METHODS: AuthMethods = {
  google: true,
  magicLink: true,
  passwordSignup: false,
  passwordReset: false,
  requiresEmailVerification: false,
};

function useLoginForm(methods: AuthMethods) {
  const router = useRouter();
  const [sent, setSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
    mode: "onChange",
  });

  const { isSubmitting, isValid } = form.formState;
  const busy = isSubmitting || googleLoading || magicLoading;

  async function handleGoogleSignIn() {
    form.clearErrors("root");
    setGoogleLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: "/post-auth",
      });
    } catch {
      form.setError("root", {
        message: "Failed to sign in with Google. Please try again.",
      });
      setGoogleLoading(false);
    }
  }

  async function sendMagicLink() {
    form.clearErrors("root");
    const email = form.getValues("email");
    const parsedEmail = z.string().email().safeParse(email);
    if (!parsedEmail.success) {
      form.setError("email", { message: "Enter a valid email address" });
      return;
    }

    setMagicLoading(true);
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: "/post-auth",
    });
    setMagicLoading(false);

    if (error) {
      form.setError("root", {
        message: authClientErrorMessage(error),
      });
      return;
    }
    setSent(true);
    toast.success("Magic link sent!", {
      description: "Check your inbox to sign in.",
    });
  }

  async function resendEmail(): Promise<string | null> {
    const { error } = await authClient.signIn.magicLink({
      email: form.getValues("email"),
      callbackURL: "/post-auth",
    });
    if (error) {
      return authClientErrorMessage(error);
    }
    toast.success("Email sent", { description: "Check your inbox." });
    return null;
  }

  function resetToNewEmail() {
    form.reset({ email: "", password: "" });
    setSent(false);
  }

  async function onSubmit({ email, password }: FormData) {
    form.clearErrors("root");

    // Password auth disabled → the form's only job is to request a magic link.
    if (!methods.passwordSignup) {
      await sendMagicLink();
      return;
    }

    if (!password) {
      form.setError("password", { message: "Enter your password" });
      return;
    }

    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      form.setError("root", {
        message: authErrorMessage(error.code, error.message),
      });
      return;
    }
    router.push("/post-auth");
    router.refresh();
  }

  return {
    sent,
    setSent,
    googleLoading,
    magicLoading,
    busy,
    form,
    isSubmitting,
    isValid,
    handleGoogleSignIn,
    sendMagicLink,
    resendEmail,
    resetToNewEmail,
    onSubmit,
  };
}

function TermsNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-base-content/60 text-xs ${className}`}>
      By signing in you agree to our{" "}
      <a
        className="underline underline-offset-4 hover:text-base-content transition-colors"
        href="/terms"
      >
        Terms of Service
      </a>{" "}
      and{" "}
      <a
        className="underline underline-offset-4 hover:text-base-content transition-colors"
        href="/privacy"
      >
        Privacy Policy
      </a>
      .
    </p>
  );
}

// ── Flat (inline) form — used inside the modal page layout ─────────────────────

export function LoginFormFlat({
  methods = DEFAULT_METHODS,
}: {
  methods?: AuthMethods;
}) {
  const {
    sent,
    setSent,
    googleLoading,
    magicLoading,
    busy,
    form,
    isSubmitting,
    isValid,
    handleGoogleSignIn,
    sendMagicLink,
    resendEmail,
    resetToNewEmail,
    onSubmit,
  } = useLoginForm(methods);

  const passwordEnabled = methods.passwordSignup;

  if (sent) {
    return (
      <SentPanel
        email={form.getValues("email")}
        onDifferentEmail={resetToNewEmail}
        onResend={resendEmail}
        onTryAgain={() => setSent(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {methods.google && (
        <>
          <Button
            className="w-full gap-2 rounded-lg h-11 text-base-content border-base-300 disabled:opacity-60"
            disabled={busy}
            onClick={handleGoogleSignIn}
            type="button"
            variant="outline"
          >
            {googleLoading ? (
              <Spinner className="size-4" />
            ) : (
              <GoogleIcon className="size-4" />
            )}
            {googleLoading ? "Connecting…" : "Continue with Google"}
          </Button>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-base-content/60 text-xs">
              or continue with email
            </span>
            <Separator className="flex-1" />
          </div>
        </>
      )}

      <Form {...form}>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-semibold text-base-content">
                  Email address
                </FormLabel>
                <FormControl>
                  <Input
                    autoComplete="email"
                    className="h-11 rounded-lg text-base-content font-medium"
                    placeholder="you@example.com"
                    type="email"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {passwordEnabled && (
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-sm font-semibold text-base-content">
                      Password
                    </FormLabel>
                    {methods.passwordReset && (
                      <Link
                        className="text-xs text-base-content/60 underline underline-offset-4 hover:text-base-content transition-colors"
                        href="/forgot-password"
                      >
                        Forgot password?
                      </Link>
                    )}
                  </div>
                  <FormControl>
                    <PasswordInput
                      autoComplete="current-password"
                      className="h-11 rounded-lg text-base-content font-medium"
                      placeholder="Enter your password"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {form.formState.errors.root && (
            <Alert variant="destructive">
              <AlertDescription>
                {form.formState.errors.root.message}
              </AlertDescription>
            </Alert>
          )}

          <Button
            className="w-full gap-2 h-11 rounded-lg text-sm font-semibold shadow-sm disabled:opacity-100 disabled:bg-base-200 disabled:text-base-content/60 disabled:shadow-none"
            disabled={!isValid || busy}
            type="submit"
          >
            {isSubmitting ? (
              <>
                <Spinner className="size-4" />
                {passwordEnabled ? "Signing in…" : "Sending…"}
              </>
            ) : passwordEnabled ? (
              <>
                <SignInIcon className="size-4" />
                Sign in
              </>
            ) : (
              <>
                <PaperPlaneTiltIcon className="size-4" />
                Send magic link
              </>
            )}
          </Button>

          {/* Magic link stays available as a secondary path when passwords are on. */}
          {passwordEnabled && methods.magicLink && (
            <Button
              className="w-full gap-2 h-10 rounded-lg text-sm font-medium"
              disabled={busy}
              onClick={sendMagicLink}
              type="button"
              variant="ghost"
            >
              {magicLoading ? (
                <Spinner className="size-4" />
              ) : (
                <PaperPlaneTiltIcon className="size-4" />
              )}
              {magicLoading ? "Sending…" : "Email me a magic link instead"}
            </Button>
          )}
        </form>
      </Form>

      {passwordEnabled && (
        <p className="text-center text-sm text-base-content/70">
          {"Don't have an account? "}
          <Link
            className="font-semibold text-base-content underline underline-offset-4 hover:opacity-80 transition-opacity"
            href="/signup"
          >
            Sign up
          </Link>
        </p>
      )}

      <TermsNotice className="pt-1" />
    </div>
  );
}

// ── Card-wrapped form — used standalone if needed ──────────────────────────────

export function LoginForm({
  methods = DEFAULT_METHODS,
}: {
  methods?: AuthMethods;
}) {
  const {
    sent,
    setSent,
    googleLoading,
    busy,
    form,
    isSubmitting,
    isValid,
    handleGoogleSignIn,
    resendEmail,
    resetToNewEmail,
    onSubmit,
  } = useLoginForm(methods);
  const passwordEnabled = methods.passwordSignup;

  if (sent) {
    return (
      <Card className="rounded-xl">
        <CardContent className="pb-6 pt-6">
          <SentPanel
            email={form.getValues("email")}
            onDifferentEmail={resetToNewEmail}
            onResend={resendEmail}
            onTryAgain={() => setSent(false)}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl">
      <CardContent className="pt-6 space-y-4">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <EnvelopeIcon className="size-5 text-primary" weight="duotone" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Sign in</h2>
          <p className="text-base-content/60 text-sm mt-0.5">
            {passwordEnabled
              ? "Enter your email and password to continue."
              : "Enter your email and we'll send you a magic link."}
          </p>
        </div>
        {methods.google && (
          <>
            <Button
              className="w-full gap-2"
              disabled={busy}
              onClick={handleGoogleSignIn}
              type="button"
              variant="outline"
            >
              {googleLoading ? (
                <Spinner className="size-4" />
              ) : (
                <GoogleIcon className="size-4" />
              )}
              Continue with Google
            </Button>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-base-content/60 text-xs">
                or continue with email
              </span>
              <Separator className="flex-1" />
            </div>
          </>
        )}
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email address</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="email"
                      placeholder="you@example.com"
                      type="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {passwordEnabled && (
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            )}
            <Button
              className="w-full gap-2"
              disabled={!isValid || busy}
              type="submit"
            >
              {isSubmitting ? (
                <>
                  <Spinner className="size-4" />
                  {passwordEnabled ? "Signing in…" : "Sending…"}
                </>
              ) : passwordEnabled ? (
                <>
                  <SignInIcon className="size-4" />
                  Sign in
                </>
              ) : (
                <>
                  <PaperPlaneTiltIcon className="size-4" />
                  Send magic link
                </>
              )}
            </Button>
          </form>
        </Form>
        <TermsNotice className="pb-2" />
      </CardContent>
    </Card>
  );
}

export { LoginForm as AuthForm };
