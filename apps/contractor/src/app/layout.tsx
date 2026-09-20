import type { Metadata, Viewport } from "next";
import "@shared/styles/warm-ink.css";
import "./globals.css";
import { fontClassName } from "@shared/fonts";
import { OfflineBanner } from "@shared/OfflineBanner";
import { NavOrigin } from "@shared/BackButton";
import { Notebook } from "@shared/Notebook";
import { DoorSwitchFab } from "@shared/DoorSwitchFab";
import { BuildState } from "@shared/BuildState";
import { Analytics } from "@vercel/analytics/next";
import { RememberPlace } from "@shared/RememberPlace";

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
        {/* Remembers where this seat was last standing (migration 199). */}
        <RememberPlace door="expert" />
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
          <Notebook payPath="/project/{job}/pay" />
          {/* IS THIS THE LATEST CODE. Nothing at all unless this deployment
              is behind main AND you are the one who can do something about
              it (Shahar, 2026-09-17: "add to every screen if vercel code is
              the latest by comparing versions running to the last one
              available on git"). */}
          {/* THE DOOR SWITCH FLOATS TOO (2026-09-19). Shahar, testing
              three seats: "so i don't need to go back all the way every
              time i need to change the seat i'm logged under." Nothing
              at all for somebody who holds one door. */}
          <DoorSwitchFab current="expert" />
          <BuildState running={process.env.VERCEL_GIT_COMMIT_SHA} />
        </div>
        {/* Vercel Web Analytics; records once switched on for the project. */}
        <Analytics />
      </body>
    </html>
  );
}
