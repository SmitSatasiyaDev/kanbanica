"use client";

import {
  CheckCircleIcon,
  SpinnerGapIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { saveUserName } from "@/app/actions/onboarding";
import {
  acceptInvite,
  declineInvite,
  getInviteState,
  type InviteErrorCode,
  type InviteState,
} from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PRODUCT_NAME } from "@/config/platform";

type PendingInvite = Extract<InviteState, { state: "pending" }>;

const ERROR_TITLES: Record<InviteErrorCode, string> = {
  auth_required: "Sign in required",
  invalid: "Invitation invalid",
  expired: "Invitation expired",
  used: "Invitation unavailable",
  wrong_user: "Wrong account",
  rate_limited: "Too many attempts",
};

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const router = useRouter();
  const [status, setStatus] = React.useState<
    "idle" | "loading" | "declining" | "success" | "declined" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = React.useState("");
  const [errorCode, setErrorCode] = React.useState<InviteErrorCode>("invalid");
  const [workspaceId, setWorkspaceId] = React.useState("");
  const [token, setToken] = React.useState("");
  const [invite, setInvite] = React.useState<PendingInvite | null>(null);
  // Set once the visitor has explicitly clicked "Accept invitation" (carried
  // across the sign-in redirect as ?accepted=1). Opening the link alone never
  // accepts anything.
  const [intent, setIntent] = React.useState(false);
  const [step, setStep] = React.useState<"intro" | "name">("intro");
  const [name, setName] = React.useState("");
  const [nameError, setNameError] = React.useState("");
  const autoAcceptedRef = React.useRef(false);
  // Synchronous in-flight locks — a rapid double click/tap can fire the
  // handler twice before the `disabled` prop takes effect on the next
  // render, which would submit the (single-use) token twice.
  const acceptingRef = React.useRef(false);
  const decliningRef = React.useRef(false);

  React.useEffect(() => {
    params.then((p) => setToken(p.token));
    setIntent(
      new URLSearchParams(window.location.search).get("accepted") === "1"
    );
  }, [params]);

  // Resolve the link's state up front, so an invite this user already accepted
  // (refresh, reopened link, auto-activated at sign-in) goes straight to the
  // workspace instead of surfacing as an error.
  React.useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    getInviteState(token).then((res) => {
      if (cancelled) {
        return;
      }
      if (res.state === "accepted") {
        setWorkspaceId(res.workspaceId);
        setStatus("success");
        router.replace(`/${res.workspaceId}`);
      } else if (res.state === "error") {
        setErrorCode(res.code);
        setErrorMsg(res.error);
        setStatus("error");
      } else {
        setInvite(res);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  async function handleAccept() {
    if (!token || acceptingRef.current) {
      return;
    }
    acceptingRef.current = true;
    setStatus("loading");
    try {
      const res = await acceptInvite(token);
      if ("error" in res) {
        setStatus("error");
        setErrorMsg(res.error);
        setErrorCode(res.code);
      } else {
        setWorkspaceId(res.workspaceId);
        setStatus("success");
        router.replace(`/${res.workspaceId}`);
      }
    } finally {
      acceptingRef.current = false;
    }
  }

  // "Accept invitation" on the intro screen. Signed out → stash the token and go
  // through the existing login/sign-up flow (it returns here with ?accepted=1);
  // signed in without a name → name step; otherwise accept straight away.
  function handleIntroAccept() {
    if (!(invite && token)) {
      return;
    }
    if (!invite.authenticated) {
      window.location.assign(`/api/invite/${encodeURIComponent(token)}`);
    } else if (invite.needsName) {
      setStep("name");
    } else {
      void handleAccept();
    }
  }

  // Back from sign-in after an explicit Accept: finish without asking again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per resolved invite; handleAccept is guarded by autoAcceptedRef
  React.useEffect(() => {
    if (!(intent && invite?.authenticated) || autoAcceptedRef.current) {
      return;
    }
    if (invite.needsName) {
      setStep("name");
    } else {
      autoAcceptedRef.current = true;
      void handleAccept();
    }
  }, [intent, invite]);

  async function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (acceptingRef.current) {
      return;
    }
    setErrorMsg("");
    const saved = await saveUserName(name);
    if ("error" in saved) {
      setNameError(saved.error);
      return;
    }
    setNameError("");
    await handleAccept();
  }

  async function handleDecline() {
    if (!token || decliningRef.current) {
      return;
    }
    decliningRef.current = true;
    setStatus("declining");
    try {
      const res = await declineInvite(token);
      if ("error" in res) {
        setStatus("error");
        setErrorMsg(res.error);
      } else {
        setStatus("declined");
      }
    } finally {
      decliningRef.current = false;
    }
  }

  if (status === "success") {
    return (
      <div className="h-full overflow-auto flex items-center justify-center bg-base-200/30 p-4">
        <div className="bg-base-100 rounded-xl border shadow-sm p-8 max-w-sm w-full text-center space-y-4">
          <CheckCircleIcon
            className="size-12 text-green-500 mx-auto"
            weight="fill"
          />
          <h1 className="text-lg font-semibold">You&rsquo;re in!</h1>
          <p className="text-sm text-base-content/60">
            You&rsquo;ve successfully joined the workspace.
          </p>
          <Button
            className="w-full"
            onClick={() => router.push(`/${workspaceId}`)}
          >
            Go to workspace
          </Button>
        </div>
      </div>
    );
  }

  if (status === "declined") {
    return (
      <div className="h-full overflow-auto flex items-center justify-center bg-base-200/30 p-4">
        <div className="bg-base-100 rounded-xl border shadow-sm p-8 max-w-sm w-full text-center space-y-4">
          <XCircleIcon
            className="size-12 text-base-content/60 mx-auto"
            weight="fill"
          />
          <h1 className="text-lg font-semibold">Invitation declined</h1>
          <p className="text-sm text-base-content/60">
            You&rsquo;ve declined this workspace invitation.
          </p>
          <Button
            className="w-full"
            onClick={() => router.push("/")}
            variant="outline"
          >
            Go home
          </Button>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="h-full overflow-auto flex items-center justify-center bg-base-200/30 p-4">
        <div className="bg-base-100 rounded-xl border shadow-sm p-8 max-w-sm w-full text-center space-y-4">
          <XCircleIcon className="size-12 text-error mx-auto" weight="fill" />
          <h1 className="text-lg font-semibold">{ERROR_TITLES[errorCode]}</h1>
          <p className="text-sm text-base-content/60">{errorMsg}</p>
          <Button
            className="w-full"
            onClick={() => router.push("/")}
            variant="outline"
          >
            Go home
          </Button>
        </div>
      </div>
    );
  }

  // Still resolving the invite (or auto-accepting after sign-in).
  if (!invite || (intent && invite.authenticated && !invite.needsName)) {
    return (
      <div className="h-full overflow-auto flex items-center justify-center bg-base-200/30 p-4">
        <SpinnerGapIcon className="size-6 animate-spin text-base-content/60" />
      </div>
    );
  }

  const busy = status === "loading" || status === "declining" || !token;
  const workspaceLabel = invite.workspaceName
    ? `\u201c${invite.workspaceName}\u201d`
    : "a workspace";

  if (step === "name") {
    return (
      <div className="h-full overflow-auto flex items-center justify-center bg-base-200/30 p-4">
        <form
          className="bg-base-100 rounded-xl border shadow-sm p-6 sm:p-8 max-w-sm w-full space-y-4"
          onSubmit={handleNameSubmit}
        >
          <div className="space-y-1 text-center">
            <h1 className="text-lg font-semibold">Create your account</h1>
            <p className="text-sm text-base-content/60">
              One last step to join {workspaceLabel}.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Name</Label>
            <Input
              autoFocus
              id="invite-name"
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              value={name}
            />
          </div>
          {invite.email && (
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input disabled id="invite-email" readOnly value={invite.email} />
            </div>
          )}
          {(nameError || errorMsg) && (
            <p className="text-sm text-error">{nameError || errorMsg}</p>
          )}
          <Button
            className="w-full"
            disabled={busy || !name.trim()}
            type="submit"
          >
            {status === "loading" ? (
              <span className="flex items-center gap-2">
                <SpinnerGapIcon className="size-4 animate-spin" />
                Joining…
              </span>
            ) : (
              "Create account & join"
            )}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto flex items-center justify-center bg-base-200/30 p-4">
      <div className="bg-base-100 rounded-xl border shadow-sm p-6 sm:p-8 max-w-sm w-full text-center space-y-4">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">You&rsquo;re invited!</h1>
          <p className="text-sm text-base-content/60">
            {invite.inviterName ? (
              <>
                <span className="font-medium text-base-content">
                  {invite.inviterName}
                </span>{" "}
                invited you to join{" "}
              </>
            ) : (
              "You\u2019ve been invited to join "
            )}
            <span className="font-medium text-base-content">
              {workspaceLabel}
            </span>{" "}
            on {PRODUCT_NAME}.
          </p>
          <p className="text-sm text-base-content/60">
            Role:{" "}
            <span className="font-medium text-base-content">{invite.role}</span>
          </p>
        </div>
        <div className="space-y-2">
          <Button
            className="w-full"
            disabled={busy}
            onClick={handleIntroAccept}
          >
            {status === "loading" ? (
              <span className="flex items-center gap-2">
                <SpinnerGapIcon className="size-4 animate-spin" />
                Accepting…
              </span>
            ) : (
              "Accept Invitation"
            )}
          </Button>
          {invite.authenticated && (
            <Button
              className="w-full"
              disabled={busy}
              onClick={handleDecline}
              variant="outline"
            >
              {status === "declining" ? (
                <span className="flex items-center gap-2">
                  <SpinnerGapIcon className="size-4 animate-spin" />
                  Declining…
                </span>
              ) : (
                "Decline"
              )}
            </Button>
          )}
        </div>
        {!invite.authenticated && (
          <p className="text-xs text-base-content/60">
            You&rsquo;ll sign in or create your account next.
          </p>
        )}
      </div>
    </div>
  );
}
