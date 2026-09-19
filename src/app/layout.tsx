import type { Metadata } from "next";
import { FootBar } from "@/components/FootBar";
import { BuildState } from "@/components/BuildState";
import { DoorSwitchFab } from "@/components/DoorSwitchFab";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Green Bergen",
  description: "We build, improve and manage homes in Bergen County.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <FootBar />
        {/* THE DOOR SWITCH FLOATS (2026-09-19). Shahar, testing three seats:
            "so i don't need to go back all the way every time i need to
            change the seat i'm logged under." Nothing for a visitor, and it
            asks which doors you hold only when you open it. */}
        <DoorSwitchFab />
        {/* IS THIS THE LATEST CODE. Nothing at all unless this deployment is
            behind main AND you are the one who can do something about it
            (Shahar, 2026-09-17). */}
        <BuildState running={process.env.VERCEL_GIT_COMMIT_SHA} />
        {/* Vercel Web Analytics: visitors, page views, routes. Records only
            once Web Analytics is switched on for the project in Vercel. */}
        <Analytics />
      </body>
    </html>
  );
}
