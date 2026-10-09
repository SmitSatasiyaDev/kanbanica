import { BellIcon, UserPlusIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { OrbitPageHeader } from "@/components/admin/orbit-page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Settings",
};

const SETTINGS_SECTIONS = [
  {
    href: "/orbit/settings/authentication",
    title: "Authentication",
    description: "Email + password access for this instance.",
    icon: UserPlusIcon,
  },
  {
    href: "/orbit/settings/notifications",
    title: "Notifications",
    description:
      "Platform-wide notification controls, such as notification emails.",
    icon: BellIcon,
  },
];

export default function OrbitSettingsPage() {
  return (
    <div>
      <OrbitPageHeader
        description="Platform-wide settings."
        eyebrow="Admin"
        title="Settings"
      />
      <div className="grid max-w-5xl gap-4 md:grid-cols-2">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <Link href={section.href} key={section.href}>
              <Card className="h-full transition-colors hover:bg-base-200/50">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-base-200">
                      <Icon className="size-4.5" />
                    </span>
                    <div className="min-w-0">
                      <CardTitle>{section.title}</CardTitle>
                      <CardDescription>{section.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
