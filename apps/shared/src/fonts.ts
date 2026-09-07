import localFont from "next/font/local";

// Manrope (OFL), one variable file vendored in ../fonts so no build depends
// on a font CDN. Apps pass fontClassName to <html>; warm-ink.css reads the
// variable. Headings use 800, body 500, buttons and labels 700.
export const manrope = localFont({
  src: [{ path: "../fonts/manrope-variable.woff2", weight: "200 800", style: "normal" }],
  variable: "--font-manrope",
  display: "swap",
});

export const fontClassName = manrope.variable;
