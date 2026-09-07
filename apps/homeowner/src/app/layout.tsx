import type { Metadata, Viewport } from "next";
import "@shared/styles/warm-ink.css";
import "./globals.css";
import { fontClassName } from "@shared/fonts";
import { OfflineBanner } from "@shared/OfflineBanner";

export const metadata: Metadata = {
  title: { default: "Green Bergen Community", template: "%s · Green Bergen Community" },
  description: "A community, not a marketplace. The safe and fast way to meet contractors that service our community.",
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
          {children}
        </div>
      </body>
    </html>
  );
}
