import { eq } from "drizzle-orm";
import { cache } from "react";
import { user } from "@/db/schema";
import { db } from "@/lib/db";
import { resolveTimezone, todayInTz } from "@/lib/due-date";

/** The user's IANA timezone (UTC when unset or invalid). Cached per request. */
export const getUserTimezone = cache(
  async (userId: string): Promise<string> => {
    const [row] = await db
      .select({ timezone: user.timezone })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return resolveTimezone(row?.timezone);
  }
);

/** The user's current calendar day (`YYYY-MM-DD`) — what "today" means for them. */
export async function getUserToday(userId: string): Promise<string> {
  return todayInTz(await getUserTimezone(userId));
}
