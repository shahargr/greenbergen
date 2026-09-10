import type { Metadata, Viewport } from "next";
import "@shared/styles/warm-ink.css";
import "./globals.css";
import { fontClassName } from "@shared/fonts";
import { OfflineBanner } from "@shared/OfflineBanner";
import { NavOrigin } from "@shared/BackButton";

export const metadata: Metadata = {
  title: { default: "Green Bergen Community", template: "%s · Green Bergen Community" },
  description: "A real community, not just a marketplace. The safe way to meet contractors in our community.",
  applicationName: "Green Bergen Community",
  appleWebApp: { capable: true, title: "Green Bergen", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f3ee",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontClassName}>
      <body>
        <div className="app">
          <OfflineBanner />
          <NavOrigin />
          {children}
        </div>
      </body>
    </html>
  );
}
