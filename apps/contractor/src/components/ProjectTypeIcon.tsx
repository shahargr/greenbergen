import type { Seat } from "@/lib/board";

// WHAT KIND OF JOB THIS IS, AS A DRAWING.
//
// Shahar (2026-09-15): "Remove the photo to reduce traffic. Split the top
// differently, so on the left it shows an icon based on project type (New
// build = construction)."
//
// The photograph was a signed 150px-tall storage URL fetched on every open of
// every project screen, to say something the row already said. This says the
// same thing in about 400 bytes of inline SVG, with no round trip and nothing
// to sign - and it says it FASTER, because a drawing of a crane reads as "a
// build" before a photograph of a house resolves into one.
//
// It is chosen from what the database already knows, most specific first: the
// catalogue package (a generator job looks like a generator), then whether
// this row is a container with jobs under it, then the domain. Nothing here
// is a guess about the project's name.
const ICONS = {
  build: (
    // A crane over a slab: a site, not a finished house.
    <>
      <path d="M4 20h16" /><path d="M6 20V8h10" /><path d="M6 8 16 8" />
      <path d="M12 8v4" /><path d="M10.5 12h3" /><path d="M6 8 6 5h6" />
    </>
  ),
  estate: (
    // Three roofs: a development, which is jobs under jobs.
    <>
      <path d="M2 20h20" /><path d="M4 20v-7l4-3 4 3v7" />
      <path d="M14 20v-9l3-2 3 2v9" /><path d="M8 20v-3h1v3" />
    </>
  ),
  power: (
    // A bolt in a box: the generator and the EV charger both.
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" /><path d="M13 8.5 10 12.5h3l-1 3.5 3.5-4.5H12z" />
    </>
  ),
  window: (
    // A window with a blind half down.
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M4 11h16" /><path d="M12 4v7" />
    </>
  ),
  house: (
    <>
      <path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-5h4v5" />
    </>
  ),
} as const;

type Kind = keyof typeof ICONS;

const LABEL: Record<Kind, string> = {
  build: "Construction",
  estate: "Development",
  power: "Electrical",
  window: "Windows and shades",
  house: "Property",
};

export function kindOf(s: Seat, hasChildren: boolean): Kind {
  if (s.package_code === "generator" || s.package_code === "ev_charger") return "power";
  if (s.package_code === "blinds") return "window";
  // A row with jobs under it is a container whatever its domain says - that
  // is what you are looking at, and it is the thing the icon should name.
  if (hasChildren || s.domain === "real estate development") return "estate";
  if (s.domain === "construction") return "build";
  return "house";
}

export function ProjectTypeIcon({ seat, hasChildren }: { seat: Seat; hasChildren: boolean }) {
  const kind = kindOf(seat, hasChildren);
  return (
    <span className="type-mark" role="img" aria-label={LABEL[kind]} title={LABEL[kind]}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ICONS[kind]}
      </svg>
    </span>
  );
}
