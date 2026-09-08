import type { SupabaseClient } from "@supabase/supabase-js";
import data from "./catalogue.data.json";
import { isMissingFunction, rpc } from "./rpc";
import { timed } from "./perf";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase/keys";

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
// What a tile draws, and nothing else: the grid never touched items, levers,
// photos or milestones, but was paid 37 kB to receive them.
export type Tile = Pick<Package, "code" | "tile_title" | "tile_line2" | "tile_group" | "availability" | "illustration" | "sort_order"> & {
  // Added by migration 012. Optional because the STATIC_PACKAGES fallback,
  // which covers a cold database, predates them.
  category?: string | null;
  season_months?: number[] | null;
};

// A section of the catalogue, grouped by what is going on in the owner's
// life rather than by trade. Labels and order live in the database so they
// can be tuned without a deploy.
export type Section = { key: string; label: string; blurb: string | null; sort_order: number };

// The fallback if the database has never answered. Same keys and order as the
// blueprint_package_categories seed, so the screens look the same either way.
export const STATIC_SECTIONS: Section[] = [
  { key: "fix", label: "Fix something", blurb: "It broke. Get it working again.", sort_order: 10 },
  { key: "upkeep", label: "Keep it up", blurb: "The recurring jobs that stop bigger ones.", sort_order: 20 },
  { key: "inside", label: "Inside", blurb: "Rooms, surfaces and everything under the roof.", sort_order: 30 },
  { key: "outside", label: "Outside", blurb: "The yard, the drive and the shell of the house.", sort_order: 40 },
  { key: "systems", label: "Power, safety & tech", blurb: "Electricity, back-up, charging and what watches the house.", sort_order: 50 },
  { key: "services", label: "Bills & services", blurb: "The last mile: what the house pays for every month.", sort_order: 60 },
  { key: "other", label: "Something else", blurb: "Not on the list? Describe it and we will price it.", sort_order: 900 },
];

// Seasonality is a WINDOW, not a section. A package filed under "Seasonal"
// disappears from where people look the rest of the year; a package that
// knows its months can be shown in its own section AND surfaced on a rail
// when its time comes. null months = all year.
//
// The month is a parameter with a default rather than a call inside the
// function body, because the React compiler rejects clock reads during
// render and this is called from server components that render tiles.
export const inSeason = (t: Tile, month: number) =>
  !t.season_months || t.season_months.length === 0 || t.season_months.includes(month);

export const currentMonth = () => new Date().getMonth() + 1;

// Only worth a rail when the season genuinely narrows the list: a package
// that runs all year is not news in November.
export const seasonal = (tiles: Tile[], month: number) =>
  tiles.filter((t) => t.season_months?.length && t.season_months.includes(month));

// ---------------------------------------------------------------------------
// WHY THIS IS A fetch AND NOT supabase.rpc().
//
// The catalogue is template data: identical for every visitor, readable by
// anon, and changed only when a price is edited. Measured on production it
// costs 5 ms in Postgres and ~190 ms warm (700 ms cold) over the wire - so the
// round trip IS the cost, and the fix is to stop making it.
//
// supabase.rpc() carries the visitor's cookie, so no cache can ever be shared.
// Calling PostgREST directly with the publishable key sends no identity at
// all, which makes the response a pure function of the URL - and lets the
// framework's data cache answer it for every instance, not one memo per
// server. One call per five minutes for the whole deployment; every other
// render pays nothing.
// ---------------------------------------------------------------------------
const CATALOGUE_TTL = 300;

async function catalogueRpc<T>(fn: string, body: Record<string, unknown> = {}, ttl = CATALOGUE_TTL): Promise<T | null> {
  try {
    const res = await timed(`catalogue.${fn}`, () =>
      fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "force-cache",
        next: { revalidate: ttl, tags: ["catalogue"] },
      }));
    if (!res.ok) {
      if (res.status !== 404) console.error(`${fn}: ${res.status} ${await res.text().catch(() => "")}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error(`${fn}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// The grid. ~3 kB, cached for everyone; the static set covers a cold database.
export async function loadTiles(): Promise<{ tiles: Tile[]; source: "database" | "static" }> {
  const rows = await catalogueRpc<Tile[]>("homeowner_catalogue_tiles");
  if (Array.isArray(rows) && rows.length > 0) return { tiles: rows, source: "database" };
  return { tiles: STATIC_PACKAGES, source: "static" };
}

// The sections. Tiny, cached the same way and for the same reason as the
// grid: it is template data, identical for every visitor.
export async function loadSections(): Promise<Section[]> {
  const rows = await catalogueRpc<Section[]>("homeowner_catalogue_sections");
  return Array.isArray(rows) && rows.length > 0 ? rows : STATIC_SECTIONS;
}

// One package, whole. ~4.5 kB - what the package page and the wizard need.
export async function loadPackage(code: string): Promise<{ pkg: Package | null; source: "database" | "static" }> {
  const row = await catalogueRpc<Package | null>("homeowner_package", { p_code: code });
  if (row && typeof row === "object" && row.code) return { pkg: row, source: "database" };
  return { pkg: findPackage(STATIC_PACKAGES, code), source: "static" };
}

// The whole catalogue, still here for anything that genuinely needs every
// package's detail at once. Nothing on the hot path does any more.
export async function loadCatalogue(supabase: SupabaseClient): Promise<Catalogue> {
  const rows = await catalogueRpc<Package[]>("homeowner_catalogue");
  if (Array.isArray(rows) && rows.length > 0) return { packages: rows, source: "database" };
  // The cached fetch cannot see a signed-in session, so a fall back through
  // the caller's client keeps a private catalogue working if we ever have one.
  const { data, error } = await timed("catalogue.rpc", () => rpc<Package[]>(supabase, "homeowner_catalogue"));
  if (!error && Array.isArray(data) && data.length > 0) return { packages: data, source: "database" };
  if (error && !isMissingFunction(error)) console.error("homeowner_catalogue:", error.message);
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
