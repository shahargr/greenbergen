import type { Metadata, Viewport } from "next";
import "@shared/styles/warm-ink.css";
import "./globals.css";
import { fontClassName } from "@shared/fonts";
import { OfflineBanner } from "@shared/OfflineBanner";

// The same shell as the homeowner and contractor apps. Three doors, one
// building - a person who runs a project, takes a job and owns a home is
// often the same person, and should never feel handed between products.
export const metadata: Metadata = {
  title: { default: "Green Bergen for builders", template: "%s · Green Bergen" },
  description: "Run the job: scope, bids, crew, money. The GC and PM view of Green Bergen.",
  applicationName: "Green Bergen for builders",
  appleWebApp: { capable: true, title: "Green Bergen Build", statusBarStyle: "default" },
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
