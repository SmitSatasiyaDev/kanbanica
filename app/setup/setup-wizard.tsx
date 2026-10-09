"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BellIcon,
  CheckIcon,
  CloudIcon,
  DesktopIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  GoogleLogoIcon,
  MoonIcon,
  RocketLaunchIcon,
  SpinnerGapIcon,
  SunIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { updateAppearanceMode } from "@/app/actions/profile";
import { createFirstAdmin } from "@/app/actions/setup";
import { GoogleOAuthSettingsForm } from "@/components/orbit/integrations/google-oauth-settings-form";
import { IntegrationConfigCard } from "@/components/orbit/integrations/integration-config-card";
import { SmtpSettingsForm } from "@/components/orbit/integrations/smtp-settings-form";
import { StorageSettingsForm } from "@/components/orbit/integrations/storage-settings-form";
import { WebPushSettingsForm } from "@/components/orbit/integrations/web-push-settings-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { THEME_OPTIONS } from "@/components/workspace/theme-settings-form";
import { PRODUCT_NAME } from "@/config/platform";
import { authClient } from "@/lib/auth-client";
import type { IntegrationSettingsSummary } from "@/lib/integration-settings";
import {
  type AppearanceMode,
  DEFAULT_APPEARANCE,
  DEFAULT_THEME,
  serializeThemeCookie,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Nothing in integration_settings has ever been saved yet at this point in a
// first-run wizard — no need to fetch current values like /orbit/integrations
// does, every field starts blank.
const EMPTY_INTEGRATION_SETTINGS: IntegrationSettingsSummary = {
  auth: { passwordSignupEnabled: false },
  notifications: { emailsEnabled: true },
  smtp: { host: "", port: 587, user: "", from: "", hasPassword: false },
  google: { clientId: "", hasClientSecret: false },
  storage: {
    driver: "local",
    endpoint: "",
    region: "",
    bucket: "",
    publicUrl: "",
    accessKeyId: "",
    hasSecretAccessKey: false,
  },
  webPush: { publicKey: "", subject: "", hasPrivateKey: false },
};

const APPEARANCE_OPTIONS: {
  value: AppearanceMode;
  label: string;
  Icon: typeof SunIcon;
}[] = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "auto", label: "System", Icon: DesktopIcon },
];

/**
 * Apply the theme + appearance to the DOM and mirror it into the cookie — the
 * same effect the app's ThemeProvider has, done directly because /setup renders
 * under the root layout (no workspace / ThemeProvider context yet).
 */
function applyTheme(theme: string, appearance: AppearanceMode) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.appearance = appearance;
  const isDark =
    appearance === "dark" ||
    (appearance === "auto" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", isDark);
  // biome-ignore lint/suspicious/noDocumentCookie: legitimate client-side cookie write (no ThemeProvider/server context yet during /setup); consistent with lib/last-workspace.ts's rememberWorkspace
  document.cookie = `${THEME_COOKIE}=${serializeThemeCookie({ theme, appearance })}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {[1, 2, 3, 4].map((n, i) => (
        <React.Fragment key={n}>
          <div
            className={cn(
              "flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-colors",
              n < step && "bg-primary text-primary-content",
              n === step && "bg-primary text-primary-content",
              n > step && "bg-base-200 text-base-content/60"
            )}
          >
            {n < step ? <CheckIcon className="size-4" weight="bold" /> : n}
          </div>
          {i < 3 && (
            <div
              className={cn(
                "h-px w-10",
                n < step ? "bg-primary" : "bg-base-300"
              )}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export function SetupWizard() {
  const router = useRouter();

  const [step, setStep] = React.useState<
    "theme" | "account" | "services" | "done"
  >("theme");
  const [theme, setThemeState] = React.useState(DEFAULT_THEME);
  const [appearance, setAppearanceState] =
    React.useState<AppearanceMode>(DEFAULT_APPEARANCE);

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const [openIntegration, setOpenIntegration] = React.useState<
    "smtp" | "google" | "storage" | "webPush" | null
  >(null);
  const [smtpConfigured, setSmtpConfigured] = React.useState(false);
  const [googleConfigured, setGoogleConfigured] = React.useState(false);
  const [storageConfigured, setStorageConfigured] = React.useState(false);
  const [webPushConfigured, setWebPushConfigured] = React.useState(false);

  function handleSaved(setConfigured: (configured: boolean) => void) {
    return (configured: boolean) => {
      setConfigured(configured);
      setOpenIntegration(null);
    };
  }

  React.useEffect(() => {
    if (step === "done") {
      router.push("/post-auth");
    }
  }, [step, router]);

  function pickTheme(next: string) {
    setThemeState(next);
    applyTheme(next, appearance);
  }
  function pickAppearance(next: AppearanceMode) {
    setAppearanceState(next);
    applyTheme(theme, next);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      return setError("Full name is required");
    }
    if (!EMAIL_RE.test(email.trim())) {
      return setError("Enter a valid email address");
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return setError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
      );
    }
    if (password !== confirm) {
      return setError("Passwords do not match");
    }

    setError("");
    setSubmitting(true);

    const res = await createFirstAdmin({ name, email, password });
    if ("error" in res) {
      setError(res.error);
      setSubmitting(false);
      return;
    }

    const signIn = await authClient.signIn.email({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signIn.error) {
      router.push("/login");
      return;
    }

    await updateAppearanceMode(appearance);
    setSubmitting(false);
    setStep("services");
  }

  const stepNumber: 1 | 2 | 3 | 4 =
    step === "theme" ? 1 : step === "account" ? 2 : step === "services" ? 3 : 4;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-base-200/30 p-4">
      <div className="w-full max-w-md">
        <Stepper step={stepNumber} />

        <div className="rounded-xl border bg-elevated p-6 shadow-sm sm:p-8">
          {step === "theme" && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-content">
                  <RocketLaunchIcon className="size-6" weight="fill" />
                </div>
                <h1 className="mt-4 text-xl font-bold">
                  Welcome to {PRODUCT_NAME}
                </h1>
                <p className="mt-1.5 text-sm text-base-content/60">
                  Let&rsquo;s get your instance set up. Pick a look — you can
                  change it later in Appearance settings.
                </p>
              </div>

              <div>
                <h2 className="mb-3 text-sm font-semibold">Color theme</h2>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {THEME_OPTIONS.map((opt) => {
                    const selected = theme === opt.id;
                    return (
                      <button
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors hover:bg-base-200/50",
                          selected
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-base-300"
                        )}
                        key={opt.id}
                        onClick={() => pickTheme(opt.id)}
                        type="button"
                      >
                        <span
                          className="flex size-7 items-center justify-center rounded-full border border-black/5"
                          style={{ backgroundColor: opt.bgPreview }}
                        >
                          {selected && (
                            <CheckIcon
                              className="size-4 text-white drop-shadow"
                              weight="bold"
                            />
                          )}
                        </span>
                        <span className="text-[11px] font-medium">
                          {opt.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <h2 className="mb-3 text-sm font-semibold">Appearance</h2>
                <div className="grid grid-cols-3 gap-2">
                  {APPEARANCE_OPTIONS.map(({ value, label, Icon }) => {
                    const selected = appearance === value;
                    return (
                      <button
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-colors hover:bg-base-200/50",
                          selected
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-base-300"
                        )}
                        key={value}
                        onClick={() => pickAppearance(value)}
                        type="button"
                      >
                        <Icon className="size-5 text-base-content/60" />
                        <span className="text-xs font-medium">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <Button className="gap-2" onClick={() => setStep("account")}>
                  Next <ArrowRightIcon className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === "account" && (
            <form className="space-y-5" onSubmit={handleCreate}>
              <div className="text-center">
                <h1 className="text-xl font-bold">Set up your account</h1>
                <p className="mt-1.5 text-sm text-base-content/60">
                  This is the administrator account for {PRODUCT_NAME}.
                </p>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="setup-name">Full name</Label>
                <Input
                  autoComplete="name"
                  disabled={submitting}
                  id="setup-name"
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  value={name}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="setup-email">Email address</Label>
                <Input
                  autoComplete="username"
                  disabled={submitting}
                  id="setup-email"
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={email}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="setup-password">Password</Label>
                <div className="relative">
                  <Input
                    autoComplete="new-password"
                    disabled={submitting}
                    id="setup-password"
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <button
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/60 hover:text-base-content"
                    onClick={() => setShowPassword((s) => !s)}
                    tabIndex={-1}
                    type="button"
                  >
                    {showPassword ? (
                      <EyeSlashIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="setup-confirm">Confirm password</Label>
                <Input
                  autoComplete="new-password"
                  disabled={submitting}
                  id="setup-confirm"
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  type={showPassword ? "text" : "password"}
                  value={confirm}
                />
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  className="w-full gap-2 sm:w-auto"
                  disabled={submitting}
                  onClick={() => setStep("theme")}
                  type="button"
                  variant="ghost"
                >
                  <ArrowLeftIcon className="size-4" /> Previous
                </Button>
                <Button
                  className="w-full gap-2 sm:w-auto"
                  disabled={submitting}
                  type="submit"
                >
                  {submitting && (
                    <SpinnerGapIcon className="size-4 animate-spin" />
                  )}
                  Create account <ArrowRightIcon className="size-4" />
                </Button>
              </div>
            </form>
          )}

          {step === "services" && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-xl font-bold">Configure services</h1>
                <p className="mt-1.5 text-sm text-base-content/60">
                  These integrations are optional. You can also configure them
                  later from Settings → Integrations. Your admin password works
                  fine either way.
                </p>
              </div>

              <div className="space-y-3">
                <IntegrationConfigCard
                  description="Send magic links, invites, and notification emails."
                  icon={<EnvelopeSimpleIcon className="size-4.5" />}
                  onOpenChange={(open) =>
                    setOpenIntegration(open ? "smtp" : null)
                  }
                  open={openIntegration === "smtp"}
                  status={smtpConfigured ? "configured" : "not-configured"}
                  title="Email (SMTP)"
                >
                  <SmtpSettingsForm
                    bare
                    initial={EMPTY_INTEGRATION_SETTINGS.smtp}
                    onSaved={handleSaved(setSmtpConfigured)}
                  />
                </IntegrationConfigCard>

                <IntegrationConfigCard
                  description='Enables the "Continue with Google" button on sign-in.'
                  icon={<GoogleLogoIcon className="size-4.5" />}
                  onOpenChange={(open) =>
                    setOpenIntegration(open ? "google" : null)
                  }
                  open={openIntegration === "google"}
                  status={
                    googleConfigured ? "restart-required" : "not-configured"
                  }
                  title="Google OAuth"
                >
                  <GoogleOAuthSettingsForm
                    bare
                    initial={EMPTY_INTEGRATION_SETTINGS.google}
                    onSaved={handleSaved(setGoogleConfigured)}
                  />
                </IntegrationConfigCard>

                <IntegrationConfigCard
                  description="Where avatars and task attachments are stored."
                  icon={<CloudIcon className="size-4.5" />}
                  onOpenChange={(open) =>
                    setOpenIntegration(open ? "storage" : null)
                  }
                  open={openIntegration === "storage"}
                  status={storageConfigured ? "configured" : "not-configured"}
                  title="File Storage"
                >
                  <StorageSettingsForm
                    bare
                    initial={EMPTY_INTEGRATION_SETTINGS.storage}
                    onSaved={handleSaved(setStorageConfigured)}
                  />
                </IntegrationConfigCard>

                <IntegrationConfigCard
                  description="Browser and desktop push notifications."
                  icon={<BellIcon className="size-4.5" />}
                  onOpenChange={(open) =>
                    setOpenIntegration(open ? "webPush" : null)
                  }
                  open={openIntegration === "webPush"}
                  status={webPushConfigured ? "configured" : "not-configured"}
                  title="Web Push"
                >
                  <WebPushSettingsForm
                    bare
                    initial={EMPTY_INTEGRATION_SETTINGS.webPush}
                    onSaved={handleSaved(setWebPushConfigured)}
                  />
                </IntegrationConfigCard>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-base-300 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  className="w-full gap-2 sm:w-auto"
                  onClick={() => setStep("done")}
                  type="button"
                  variant="ghost"
                >
                  Skip for now
                </Button>
                <Button
                  className="w-full gap-2 sm:w-auto"
                  onClick={() => setStep("done")}
                  type="button"
                >
                  Continue <ArrowRightIcon className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <SpinnerGapIcon className="size-8 animate-spin text-base-content/60" />
              <h1 className="text-lg font-semibold">
                Setting up your workspace…
              </h1>
              <p className="text-sm text-base-content/60">
                Redirecting to your dashboard…
              </p>
            </div>
          )}
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-base-content/60">
          <CheckIcon className="size-3.5 text-primary" weight="bold" />
          Runs once — this page disappears after your first admin is created.
        </p>
      </div>
    </div>
  );
}
