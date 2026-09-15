import type { Metadata, Viewport } from "next";
import "@shared/styles/warm-ink.css";
import "./globals.css";
import { fontClassName } from "@shared/fonts";
import { OfflineBanner } from "@shared/OfflineBanner";
import { NavOrigin } from "@shared/BackButton";
import { Notebook } from "@shared/Notebook";
import { Analytics } from "@vercel/analytics/next";

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
          {/* THE NOTEBOOK FLOATS ON EVERY SCREEN (Shahar, 2026-09-15:
              "something that would float on every screen allowing me to take
              a note"). It is in the layout rather than on the screens that
              seemed likely, because the thought you want to keep arrives on
              whichever screen you happen to be reading. Notes are private to
              their author and hide themselves on the doors where there is
              nothing yet to take a note about. */}
          <Notebook />
        </div>
        {/* Vercel Web Analytics; records once switched on for the project. */}
        <Analytics />
      </body>
    </html>
  );
}
