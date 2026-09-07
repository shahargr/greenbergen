import type { Metadata, Viewport } from "next";
import "@shared/styles/warm-ink.css";
import "./globals.css";
import { fontClassName } from "@shared/fonts";
import { OfflineBanner } from "@shared/OfflineBanner";

export const metadata: Metadata = {
  title: { default: "Green Bergen", template: "%s · Green Bergen" },
  description: "The Bergen community: best-in-class contractors, transparent pricing.",
  applicationName: "Green Bergen",
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
