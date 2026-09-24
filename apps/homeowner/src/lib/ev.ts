import type { Package, PhotoReq } from "@shared/catalogue";

// THE EV CHARGER ASKS ITS OWN QUESTIONS (Shahar, 2026-09-24, a three-screen
// mock): 1. your charging needs and location, 2. the electrical panel,
// 3. the target wall and how you want it done. The generic wizard's house
// facts and budget ask nothing an electrician needs for a charger; these do.
//
// Two kinds of answer, kept apart on purpose:
// - PRICED: the distance slider IS the "distance" lever - it only picks one
//   of the lever's options, so the price is the catalogue's own. Every other
//   lever (have the charger / contractor supplies) renders as it does on the
//   package page.
// - NOT PRICED: where it goes, the car, the amperage, the subpanel. They go
//   on the booking's facts as facts.ev, for the electrician to confirm from
//   the photos. None of them moves the number - a 48 A charger needing a
//   60 A circuit is a real difference, and it is for Shahar to make a lever
//   of it, not for this screen to invent a delta.
//
// usesEvFlow() checks the data before trusting it: if the distance lever is
// renamed or loses a band, the package falls back to the generic wizard
// rather than a slider that picks an option that is not there.

export const EV_CODE = "ev_charger";
export const DISTANCE_LEVER = "distance";
// The spot slot is step 3; every other photo slot is the panel, step 2.
export const WALL_SLOT = "spot";

// Feet -> the lever's option key. Matches the option labels: under 25,
// 25-60, over 60.
const BANDS: { key: string; below: number }[] = [
  { key: "near", below: 25 },
  { key: "mid", below: 61 },
  { key: "far", below: Infinity },
];
export const FT_MIN = 5;
export const FT_MAX = 80;
export const FT_STEP = 5;
export const bandFor = (ft: number) => BANDS.find((b) => ft < b.below)!.key;
// Where the slider starts for a band chosen on the package page.
export const feetFor = (key: string | undefined) => (key === "mid" ? 40 : key === "far" ? 75 : 15);
export const feetLabel = (ft: number) => (ft >= FT_MAX ? `${FT_MAX}+ ft` : `${ft} ft`);

export function usesEvFlow(pkg: Package): boolean {
  if (pkg.code !== EV_CODE) return false;
  const lever = pkg.levers.find((l) => l.key === DISTANCE_LEVER);
  return !!lever && BANDS.every((b) => lever.options.some((o) => o.key === b.key));
}

export const panelSlots = (pkg: Package): PhotoReq[] => pkg.photos.filter((p) => p.key !== WALL_SLOT);
export const wallSlots = (pkg: Package): PhotoReq[] => pkg.photos.filter((p) => p.key === WALL_SLOT);

export type EvLocation = "garage" | "outside";
export type EvAmps = "32" | "40" | "48" | "unsure";
export type EvAnswers = { location: EvLocation; vehicle: string; feet: number; amps: EvAmps; subpanel: boolean; subpanel_where: string };
export const EV_DEFAULTS: EvAnswers = { location: "garage", vehicle: "", feet: 15, amps: "40", subpanel: false, subpanel_where: "" };

export const AMPS: { key: EvAmps; label: string; hint: string }[] = [
  { key: "32", label: "32 A", hint: "Runs on the 50 A circuit in the price." },
  { key: "40", label: "40 A", hint: "The most common Level 2 setting. Runs on the 50 A circuit in the price." },
  { key: "48", label: "48 A", hint: "Needs a 60 A circuit rather than the 50 A one in the price. The electrician checks your panel can carry it and tells you before anything changes." },
  { key: "unsure", label: "Not sure", hint: "Fine. The electrician sets it from your car and your panel photo." },
];

// The cars people in Bergen actually park in a garage, then the honest
// answers for everyone else. A car is context, not a price.
export const VEHICLES: string[] = [
  "Tesla Model 3", "Tesla Model Y", "Tesla Model S", "Tesla Model X", "Tesla Cybertruck",
  "Rivian R1S", "Rivian R1T", "Ford Mustang Mach-E", "Ford F-150 Lightning",
  "Chevrolet Equinox EV", "Chevrolet Blazer EV", "Chevrolet Silverado EV", "Chevrolet Bolt",
  "Hyundai Ioniq 5", "Hyundai Ioniq 6", "Kia EV6", "Kia EV9", "Volkswagen ID.4",
  "BMW i4", "BMW iX", "Mercedes-Benz EQE", "Mercedes-Benz EQS", "Audi Q4 e-tron", "Audi Q8 e-tron",
  "Polestar 2", "Volvo EX30", "Nissan Ariya", "Nissan Leaf", "Honda Prologue", "Toyota bZ4X",
  "Lucid Air", "Cadillac Lyriq",
  "A plug-in hybrid", "Another EV", "Not bought yet",
];

// What goes on project_bookings.facts.ev. Blank answers are left out.
export function evFacts(a: EvAnswers, distanceLabel: string | null) {
  return {
    location: a.location === "garage" ? "Inside the garage" : "Outside / driveway",
    ...(a.vehicle ? { vehicle: a.vehicle } : {}),
    distance_ft: a.feet >= FT_MAX ? `${FT_MAX}+` : a.feet,
    ...(distanceLabel ? { distance_band: distanceLabel } : {}),
    amps: a.amps === "unsure" ? "Not sure" : `${a.amps} A`,
    subpanel: a.subpanel,
    ...(a.subpanel && a.subpanel_where.trim() ? { subpanel_where: a.subpanel_where.trim() } : {}),
  };
}
