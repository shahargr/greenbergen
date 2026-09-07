import localFont from "next/font/local";

// Barlow and Barlow Condensed (OFL), vendored so no build depends on a font
// CDN. Both apps load these in their root layout and pass the two class
// names to <html>; industry.css reads the variables.
export const barlow = localFont({
  src: [
    { path: "../fonts/barlow-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/barlow-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/barlow-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-barlow",
  display: "swap",
});

export const barlowCondensed = localFont({
  src: [
    { path: "../fonts/barlow-condensed-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/barlow-condensed-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const fontClassName = `${barlow.variable} ${barlowCondensed.variable}`;
