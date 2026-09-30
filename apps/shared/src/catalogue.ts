import type { SupabaseClient } from "@supabase/supabase-js";
import data from "./catalogue.data.json";
import { isMissingFunction, rpc } from "./rpc";
import { timed } from "./perf";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase/keys";
import { findPackage, type CommunityService, type DiyList, type Package, type Section, STATIC_SECTIONS, type Tile } from "./catalogue.shared";

// The types and the pure arithmetic live in catalogue.shared.ts, where a
// client component can import them without the loaders; everything there is
// re-exported here so a server caller keeps importing one module.
export * from "./catalogue.shared";

// The package catalogue. The database (blueprint_packages and friends,
// read through homeowner_catalogue()) is the source of truth; the JSON
// beside this file is the same launch set, used until the migration in
// db/ is applied and as the seed that migration is generated from.

export const STATIC_PACKAGES = data.packages as Package[];
export const COMMUNITY_SERVICES = data.community_services as CommunityService[];

export type Catalogue = { packages: Package[]; source: "database" | "static" };

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
// SUGGESTED PRODUCTS (migration 077). Shahar, on the EV charger package:
// "Build a list of suggested products to purchase as part of the package,
// which is optional. Just grab the product name, rating if you have, price,
// and short link stating the product and store."
//
// Never part of the price - the package buys the LABOUR. The price and the
// rating are a snapshot of what the store showed on checked_on, not a promise,
// and either may be null because nobody has recorded one yet.
export type PackageProduct = {
  id: string; name: string; store: string; url: string;
  price_cents: number | null; rating: number | null; rating_count: number | null;
  note: string | null; checked_on: string | null;
};

export async function loadPackageProducts(code: string): Promise<PackageProduct[]> {
  const rows = await catalogueRpc<PackageProduct[]>("homeowner_package_products", { p_code: code });
  return Array.isArray(rows) ? rows : [];
}

// HOW THE WORK ACTUALLY GOES (migration 187). The same steps the office
// follows, in the same order, minus the ones marked ours only - so a
// homeowner can read the whole job before deciding, and do it themselves if
// they want to. Every step names the trade whose hand it needs, which is the
// honest answer to "can I do this myself": the generator needs a licensed
// plumber and a licensed electrician whoever is running it.
//
// Cached like the rest of the catalogue: it is the same for every visitor and
// changes when we change the process, not per request. Null when the package
// has no process written for it - the screen says so rather than inventing one.
export type ProcessTrade = { trade: string; need: "required" | "optional"; note: string | null };
export type ProcessStep = {
  n: number; step: string; why: string | null; asks: string | null; photo: string | null;
  trade: string | null; is_gate: boolean; decides: string | null;
  answers: string[] | null; only_if: Record<string, string> | null;
};
export type PackageProcess = {
  package: string; name: string; process: string;
  trades: ProcessTrade[]; steps: ProcessStep[];
};

export async function loadPackageProcess(code: string): Promise<PackageProcess | null> {
  const row = await catalogueRpc<PackageProcess | null>("homeowner_package_process", { p_code: code });
  return row && typeof row === "object" && Array.isArray(row.steps) && row.steps.length > 0 ? row : null;
}

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

// ---------------------------------------------------------------------------
// Public copy, editable in Admin so the things a stranger reads first do not
// need a deploy: the tagline under the wordmark (config.public_tagline,
// migration 013), whether that line is drawn over the homeowner landing
// photograph (config.public_tagline_shown, migration 123) and the photograph
// itself (config.landing_hero_url, migration 072).
//
// Cached exactly like the catalogue and for the same reason: it is identical
// for every visitor and changes when someone edits it, not per request. Up to
// five minutes between an edit and every deployment seeing it.
// bobHero is the photograph behind Ask Bob (migration 193) - its own field,
// because the landing photograph is a couple in front of a finished house and
// this one is somebody who knows how to do the work.
// markupPct is the one mark-up setting (migration 237) - what a visitor's
// prices carry; a signed-in member reads their own (my_markup_pct).
export type PublicSettings = { tagline: string | null; hero: string | null; bobHero: string | null; taglineShown: boolean; markupPct: number };

export async function loadPublicSettings(): Promise<PublicSettings> {
  const row = await catalogueRpc<{ tagline?: string | null; hero?: string | null; bob_hero?: string | null; tagline_shown?: boolean; markup_pct?: number | string | null }>("public_settings");
  return {
    tagline: row?.tagline ?? null,
    hero: row?.hero ?? null,
    bobHero: row?.bob_hero ?? null,
    taglineShown: row?.tagline_shown ?? false,
    // Until the setting has been read, the default it was created with.
    markupPct: row?.markup_pct != null ? Number(row.markup_pct) : 15,
  };
}

export async function loadTagline(): Promise<string | null> {
  return (await loadPublicSettings()).tagline;
}

// ---------------------------------------------------------------------------
// THE DIY LIST (migration 241). A package's own how-to for the person holding
// the drill - not the contractor's scope, which a DIY plan no longer carries.
// Free to read (Shahar, 2026-09-25), with a suggested price paid by Venmo;
// nothing about the payment is recorded. Anon-callable and cached like the
// rest of the catalogue.

export async function loadDiyList(code: string): Promise<DiyList | null> {
  const row = await catalogueRpc<DiyList | null>("homeowner_diy_list", { p_code: code });
  return row && typeof row === "object" && Array.isArray(row.steps) && row.steps.length > 0 ? row : null;
}
