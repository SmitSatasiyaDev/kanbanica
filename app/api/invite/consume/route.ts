import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { clearPendingInvite, readPendingInvite } from "@/lib/pending-join";

/**
 * Called from `/post-auth` once the user is authenticated and has a name:
 * clears the pending-invite cookie and returns them to `/invite/<token>`.
 * `?accepted=1` records that they already clicked "Accept invitation" before
 * signing in, so the page finishes (name step if needed, then accept) without
 * asking again. Nothing is accepted here — the invite page validates + accepts.
 */
export async function GET() {
  const token = await readPendingInvite();
  await clearPendingInvite();
  const path = token ? `/invite/${token}?accepted=1` : "/post-auth";
  return NextResponse.redirect(new URL(path, env.APP_URL));
}
