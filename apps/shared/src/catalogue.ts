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
// A scope line. work = what gets done; assurance = what comes with it;
// hardware = what the homeowner buys before the crew arrives, not in the
// price, with the suggested product pages (migration 054). kind and links
// are optional because the static fallback predates them: no kind reads
// as work.
export type StoreLink = { label: string; url: string };
export type Item = { label: string; detail: string | null; kind?: "work" | "assurance" | "hardware"; links?: StoreLink[] };
export const isHardware = (i: Item) => i.kind === "hardware";
// A band on the package page (migration 067): a CLAIM makes one point in a
// headline and a line or two, an FAQ is a question and its answer. Optional
// because the static fallback predates them and most packages have none yet.
export type PageSection = { kind: "claim" | "faq"; headline: string; body: string | null; image_url: string | null };
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
  sort_order: number; items: Item[]; levers: Lever[]; photos: PhotoReq[];
  milestones: MilestoneTpl[];
  // The explainer versions (migration 049). Optional: the static fallback
  // predates them, and a package may simply have none.
  videos?: { id: string; label: string; url: string }[];
  // A photograph of the work and the landing-page flag (migration 052).
  photo_url?: string | null;
  promote?: boolean;
  // The story the page tells above the price (migration 067).
  sections?: PageSection[];
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
  // Added by migration 023. trade is the package's trade; covered says whether
  // ANY approved contractor carries it - computed with the same predicate the
  // offer loop uses to pick who receives the job, so a live tile means the
  // offer reaches someone. Optional for the same reason as above; undefined
  // (the static fallback) is read as covered, because a cold database is not
  // evidence that nobody can do the work.
  trade?: string | null;
  covered?: boolean;
  // Added by migration 052 for the landing page: the photograph of the work,
  // whether Admin chose to feature it, and the basic-setup price so the
  // landing can say "from $1,180" without loading every package.
  photo_url?: string | null;
  promote?: boolean;
  base_price_cents?: number | null;
  // The cheapest configuration (migration 053): base plus the lowest answer
  // on every lever. What a "from" line says; computed in the database so a
  // price edit moves every panel at once.
  from_price_cents?: number | null;
};

// The number after "from": the floor when the database gives it, the base
// price on the static fallback, nothing when the package has no price.
export const fromPrice = (t: Tile): number | null => t.from_price_cents ?? t.base_price_cents ?? null;

// WHAT THE LANDING PAGE FEATURES. Admin's choice first (promote, in shelf
// order); when nothing is flagged, the first open front-page tiles, so the
// page is never empty. Capped at six (Shahar's list, 2026-09-10: EV,
// generator, water heater, faucet, internet + contract review, GC as a
// service): it is a shop window, not the catalogue.
export function featured(tiles: Tile[], max = 6): Tile[] {
  const chosen = tiles.filter((t) => t.promote).sort((a, b) => a.sort_order - b.sort_order);
  if (chosen.length > 0) return chosen.slice(0, max);
  return tiles.filter((t) => t.tile_group === "front" && isOpen(t)).sort((a, b) => a.sort_order - b.sort_order).slice(0, max);
}

// The two questions a tile answers, kept apart because they fail differently:
// priced is "do we have a number", covered is "is there anyone to send it to".
// Only a package that passes both can be booked turn-key today.
export const isPriced = (t: Tile) => t.availability === "priced";
export const isCovered = (t: Tile) => t.covered !== false;
export const isBookable = (t: Tile) => isPriced(t) && isCovered(t);
// OPEN is wider than bookable. Shahar: "general contractor is already live"
// - it was drawn dim because it has no fixed price, but a covered quote
// package is a live door: a person on the other side answers. So a tile is
// open when someone approved carries the trade and the page behind it does
// something today - books it, or takes your sentence to that person. Only
// "coming soon" and "nobody carries it yet" are dim.
export const isQuote = (t: Tile) => t.availability === "quote" || t.availability === "custom";
export const isOpen = (t: Tile) => isCovered(t) && (isPriced(t) || isQuote(t));

// Why a tile is dim, in the member's words. Order matters: no price is a
// bigger gap than no contractor, and "coming soon" outranks both.
export function dimReason(t: Tile): string {
  if (t.availability === "coming_soon") return "Coming soon";
  // "Coming soon", not "No contractor yet": the second is our problem
  // described to a customer, and it reads as a shrug. It is the same
  // state either way - priced, nobody approved carries the trade.
  if (!isCovered(t)) return "Coming soon";
  if (t.availability === "quote") return "We look first";
  if (t.availability === "custom") return "Tell us what you need";
  return "Not yet";
}

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

// Is anyone approved to do this trade? Cached exactly like the rest of the
// catalogue: the answer is the same for every visitor and changes when someone
// is approved, not per request. The package page asks it separately rather
// than fattening homeowner_package, because it is one boolean and it changes
// on a different clock from the package itself.
//
// A failed read returns true - unavailable coverage must never present a real
// package as unavailable.
export async function loadCovered(trade: string | null | undefined): Promise<boolean> {
  if (!trade) return true;
  const row = await catalogueRpc<boolean>("homeowner_trade_covered", { p_trade: trade });
  return row === false ? false : true;
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

// ---------------------------------------------------------------------------
// Public copy, editable in Admin so the things a stranger reads first do not
// need a deploy: the tagline under the wordmark (config.public_tagline,
// migration 013) and the photograph across the top of the homeowner landing
// page (config.landing_hero_url, migration 072).
//
// Cached exactly like the catalogue and for the same reason: it is identical
// for every visitor and changes when someone edits it, not per request. Up to
// five minutes between an edit and every deployment seeing it.
export type PublicSettings = { tagline: string | null; hero: string | null };

export async function loadPublicSettings(): Promise<PublicSettings> {
  const row = await catalogueRpc<{ tagline?: string | null; hero?: string | null }>("public_settings");
  return { tagline: row?.tagline ?? null, hero: row?.hero ?? null };
}

export async function loadTagline(): Promise<string | null> {
  return (await loadPublicSettings()).tagline;
}
