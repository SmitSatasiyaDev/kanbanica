import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AutoAppearanceScript } from "@/components/theme/auto-appearance-script";
import { Toaster } from "@/components/ui/sonner";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/config/platform";
import {
  parseThemeCookie,
  resolvesToDarkOnServer,
  THEME_COOKIE,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: PRODUCT_NAME,
    template: `%s | ${PRODUCT_NAME}`,
  },
  description: PRODUCT_DESCRIPTION,
  icons: {
    icon: "/Kanbanica.png",
    apple: "/Kanbanica.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // Mirrored from the DB on every theme save — see components/theme/theme-provider.tsx.
  const { theme, appearance } = parseThemeCookie(
    (await cookies()).get(THEME_COOKIE)?.value
  );

  return (
    <html
      className={cn(
        "scroll-smooth font-sans",
        inter.variable,
        resolvesToDarkOnServer(appearance) && "dark"
      )}
      data-appearance={appearance}
      data-theme={theme}
      lang="en"
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <AutoAppearanceScript />
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
