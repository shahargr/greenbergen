import type { Metadata } from "next";
import { FootBar } from "@/components/FootBar";
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
        {/* Vercel Web Analytics: visitors, page views, routes. Records only
            once Web Analytics is switched on for the project in Vercel. */}
        <Analytics />
      </body>
    </html>
  );
}
