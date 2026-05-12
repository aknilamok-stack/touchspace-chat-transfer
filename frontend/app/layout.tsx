import type { Metadata, Viewport } from "next";
import { SessionGuard } from "@/components/auth/session-guard";
import { DesktopOfflineGuard } from "@/components/runtime/desktop-offline-guard";
import "./globals.css";

export const metadata: Metadata = {
  title: "TouchSpace Workspace",
  description: "Внутреннее приложение TouchSpace для администраторов, менеджеров и поставщиков.",
  applicationName: "TouchSpace Workspace",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TouchSpace",
  },
  icons: {
    icon: [
      { url: "/pwa/icon-192.svg", type: "image/svg+xml" },
      { url: "/pwa/icon-512.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/pwa/icon-192.svg", type: "image/svg+xml" }],
    shortcut: ["/pwa/icon-192.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[radial-gradient(circle_at_top,#eef4ff_0%,#f8fafc_48%,#e8eef8_100%)] text-slate-950">
        <SessionGuard />
        <DesktopOfflineGuard />
        {children}
      </body>
    </html>
  );
}
