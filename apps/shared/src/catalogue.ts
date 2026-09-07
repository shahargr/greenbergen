import type { SupabaseClient } from "@supabase/supabase-js";
import data from "./catalogue.data.json";
import { isMissingFunction, rpc } from "./rpc";
import { timed } from "./perf";

// The package catalogue. The database (blueprint_packages and friends,
// read through homeowner_catalogue()) is the source of truth; the JSON
// beside this file is the same launch set, used until the migration in
// db/ is applied and as the seed that migration is generated from.

export type Availability = "priced" | "coming_soon" | "quote" | "custom";
export type LeverOption = { key: string; label: string; price_delta_cents: number; is_default: boolean; chip?: string | null };
export type Lever = { key: string; label: string; control: "seg" | "radio"; question: string | null; options: LeverOption[] };
export type PhotoReq = { key: string; label: string; hint: string | null };
export type MilestoneKind = "booked" | "accepted" | "payment" | "task" | "done";
export type MilestoneTpl = {
  key: string; kind: MilestoneKind; name: string; sequence_no: number;
  percent_of_contract: number | null; typical_range: string | null; trigger_description: string | null;
};
export type Package = {
  code: string; name: string; tile_title: string; tile_line2: string | null; trade: string | null;
  tile_group: "front" | "more"; availability: Availability; base_price_cents: number | null;
  config_label: string | null; requires_permit: boolean; permit_deposit_pct: number | null;
  instant_book: boolean; approval_note: string | null; illustration: string; description: string | null;
  sort_order: number; items: { label: string; detail: string | null }[]; levers: Lever[]; photos: PhotoReq[];
  milestones: MilestoneTpl[];
};
export type CommunityService = {
  code: string; name: string; cadence: string; summary: string; description: string; price_cents: number;
  price_label: string; charged: string; season: string; illustration: string;
};

export const STATIC_PACKAGES = data.packages as Package[];
export const COMMUNITY_SERVICES = data.community_services as CommunityService[];

export type Catalogue = { packages: Package[]; source: "database" | "static" };

// The catalogue is 37 kB of template data, identical for every visitor and
// readable by anon - so one copy per server instance is safe and correct.
// Measured: the query costs 5 ms in Postgres but 190 ms warm (700 ms on a
// cold instance) over the wire, on EVERY package view. Holding it for five
// minutes turns that into one call per instance per five minutes. Only a
// real database answer is ever memoised; the JSON fallback is not, so a
// blip never sticks.
const HOLD_MS = 5 * 60 * 1000;
let held: { at: number; packages: Package[] } | null = null;

export async function loadCatalogue(supabase: SupabaseClient): Promise<Catalogue> {
  if (held && Date.now() - held.at < HOLD_MS) return { packages: held.packages, source: "database" };
  const { data: rows, error } = await timed("catalogue.rpc", () => rpc<Package[]>(supabase, "homeowner_catalogue"));
  if (!error && Array.isArray(rows) && rows.length > 0) {
    held = { at: Date.now(), packages: rows };
    return { packages: rows, source: "database" };
  }
  if (error && !isMissingFunction(error)) {
    // A real error on the live catalogue still leaves the static set usable.
    console.error("homeowner_catalogue:", error.message);
  }
  return { packages: STATIC_PACKAGES, source: "static" };
}

export const findPackage = (packages: Package[], code: string) => packages.find((p) => p.code === code) ?? null;

export type Selections = Record<string, string>;

export const defaultSelections = (pkg: Package): Selections =>
  Object.fromEntries(pkg.levers.map((l) => [l.key, (l.options.find((o) => o.is_default) ?? l.options[0]!).key]));

export const priceFor = (pkg: Package, sel: Selections) => {
  if (pkg.base_price_cents == null) return null;
  let total = pkg.base_price_cents;
  for (const lever of pkg.levers) {
    const opt = lever.options.find((o) => o.key === sel[lever.key]);
    if (opt) total += opt.price_delta_cents;
  }
  return total;
};

// "50 gal · gas · same spot" - how a chosen configuration reads.
export const configLabel = (pkg: Package, sel: Selections) => {
  const parts: string[] = [];
  for (const lever of pkg.levers) {
    const opt = lever.options.find((o) => o.key === sel[lever.key]);
    if (opt && !opt.is_default) parts.push(opt.label);
  }
  return parts.length ? parts.join(" · ") : pkg.config_label ?? "most common setup";
};

// The extra the chosen options add over the base, e.g. "+$160 for 50 gal".
export const deltaNotes = (pkg: Package, sel: Selections) =>
  pkg.levers
    .map((l) => l.options.find((o) => o.key === sel[l.key]))
    .filter((o): o is LeverOption => !!o && !o.is_default && o.price_delta_cents !== 0)
    .map((o) => `${o.price_delta_cents > 0 ? "+" : "−"}$${Math.abs(Math.round(o.price_delta_cents / 100)).toLocaleString()} for ${o.label}`);

export const depositCents = (pkg: Package, price: number | null) =>
  price != null && pkg.requires_permit && pkg.permit_deposit_pct ? Math.round((price * pkg.permit_deposit_pct) / 100) : null;

// Selections ride the URL between the package page and the booking wizard:
// ?sel=tank:50,fuel:gas
export const encodeSelections = (sel: Selections) =>
  Object.entries(sel).map(([k, v]) => `${k}:${v}`).join(",");
export const decodeSelections = (pkg: Package, raw: string | undefined | null): Selections => {
  const sel = defaultSelections(pkg);
  if (!raw) return sel;
  for (const part of raw.split(",")) {
    const [k, v] = part.split(":");
    const lever = pkg.levers.find((l) => l.key === k);
    if (lever && lever.options.some((o) => o.key === v)) sel[k!] = v!;
  }
  return sel;
};
