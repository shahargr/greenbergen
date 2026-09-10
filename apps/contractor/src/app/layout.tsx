import type { Metadata, Viewport } from "next";
import "@shared/styles/warm-ink.css";
import "./globals.css";
import { fontClassName } from "@shared/fonts";
import { OfflineBanner } from "@shared/OfflineBanner";
import { NavOrigin } from "@shared/BackButton";

// The same shell as the homeowner app, deliberately. A contractor and a
// homeowner are two sides of one community, not two products, and they
// share one login - so they should recognise the place.
export const metadata: Metadata = {
  title: { default: "Green Bergen for contractors", template: "%s · Green Bergen" },
  description: "Community price, no bidding, no lead fees. Work in Bergen County from the people who live there.",
  applicationName: "Green Bergen for contractors",
  appleWebApp: { capable: true, title: "Green Bergen Pro", statusBarStyle: "default" },
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
