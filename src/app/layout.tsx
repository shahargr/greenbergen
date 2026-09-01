import type { Metadata } from "next";
import { FootBar } from "@/components/FootBar";
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
      </body>
    </html>
  );
}
