import { OrbitPageHeader } from "@/components/admin/orbit-page-header";
import { NotificationEmailSettingsForm } from "@/components/orbit/settings/notification-email-settings-form";
import { getIntegrationSettingsSummary } from "@/lib/integration-settings";

export const metadata = {
  title: "Notification settings",
};

// Settings queried here must be per-request, not build-time.
export const dynamic = "force-dynamic";

export default async function OrbitNotificationSettingsPage() {
  const settings = await getIntegrationSettingsSummary();

  return (
    <div>
      <OrbitPageHeader
        description="Platform-wide notification controls. Changes apply immediately to every workspace."
        eyebrow="Settings"
        title="Notifications"
      />
      <div className="max-w-5xl">
        <NotificationEmailSettingsForm initial={settings.notifications} />
      </div>
    </div>
  );
}
