import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { GeneralSettingsForm } from "@/components/workspace/general-settings-form";
import { PRODUCT_NAME } from "@/config/platform";
import { workspace } from "@/db/schema";
import { db } from "@/lib/db";

interface GeneralSettingsPageProps {
  params: Promise<{ workspaceId: string }>;
}

export const metadata = { title: `General Settings — ${PRODUCT_NAME}` };

export default async function GeneralSettingsPage({
  params,
}: GeneralSettingsPageProps) {
  const { workspaceId } = await params;

  const [ws] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      logoEmoji: workspace.logoEmoji,
      timezone: workspace.timezone,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));

  if (!ws) {
    notFound();
  }

  return <GeneralSettingsForm workspace={ws} />;
}
