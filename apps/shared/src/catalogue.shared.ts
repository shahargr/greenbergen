// THE CATALOGUE'S VOCABULARY AND ARITHMETIC - the part with no server in it.
//
// Every type a package is made of, and the pure functions over one: what a
// configuration costs, how it reads, how it is paid, how selections ride the
// URL. Nothing here fetches, reads a key or opens the JSON fallback, which is
// the point: the booking wizard, the Adjust panel and the surveys are client
// components, and importing the loaders beside these helpers pulled the whole
// launch catalogue (catalogue.data.json) and the Supabase glue into their
// bundle. catalogue.ts re-exports everything here, so a server caller still
// imports one module.

export type Availability = "priced" | "coming_soon" | "quote" | "custom";
// upto / unit (migration 235): a lever that is a measured quantity - feet from
// the panel - has a unit, and each option is a band reaching up to its upto
// (null on the last, open-ended one), so an app can draw a slider over it.
export type LeverOption = { key: string; label: string; price_delta_cents: number; is_default: boolean; chip?: string | null; upto?: number | null };
export type Lever = { key: string; label: string; control: "seg" | "radio"; question: string | null; options: LeverOption[]; unit?: string | null };
// step / guide / example_url (migration 236): on a package with guided_photos
// a slot is taken on one screen of the walk-through - slots sharing a step
// share a screen - under a one-line instruction over the viewfinder, with an
// optional reference picture behind it.
export type PhotoReq = { key: string; label: string; hint: string | null; step?: number | null; guide?: string | null; example_url?: string | null };
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
  // PAYMENT TERMS (migration 242): an installment is a percent OR a fixed
  // amount (contractor-price cents, marked up like every price), due
  // due_days after due_from. Optional: the static fallback predates them.
  amount_cents?: number | null; due_days?: number; due_from?: DueFrom;
};
export type DueFrom = "milestone" | "accepted" | "posted";
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
  // A gas job asks about the house's gas appliances before the price
  // (migrations 228-230, 235); gas_kinds are the questions, in order.
  needs_gas_survey?: boolean;
  gas_kinds?: GasKind[] | null;
  // The booking walks the photos one camera screen at a time (migration 236).
  guided_photos?: boolean;
  // The VIEWER's mark-up on top of the contractor price (migration 237),
  // attached per request by the homeowner app - never by the shared cached
  // read, which is the same for everyone. Unset reads as no mark-up, so the
  // contractor side keeps seeing contractor prices.
  markup_pct?: number;
  // Who the homeowner pays each payment milestone to (migration 240): the
  // contractor (who owes Green Bergen the mark-up for the lead), or Green
  // Bergen (which keeps the mark-up and pays the contractor the rest).
  // Optional: the static fallback predates it, and absent means contractor.
  collected_by?: "contractor" | "green_bergen" | null;
};
// Does the booking ask its own questions before the price? A gas job asks its
// survey (migration 235), a guided package walks its photos (236). Either way
// it ends in the turn-key / DIY fork itself, so the take/ screen is skipped.
export const guidedApplies = (pkg: Package) => !!pkg.guided_photos && pkg.photos.some((p) => p.step != null);
export const asksFirst = (pkg: Package) => (!!pkg.needs_gas_survey && (pkg.gas_kinds?.length ?? 0) > 0) || guidedApplies(pkg);
export type GasKind = { key: string; label: string; hint: string | null; typical_low: number | null; typical_high: number | null };
export type CommunityService = {
  code: string; name: string; cadence: string; summary: string; description: string; price_cents: number;
  price_label: string; charged: string; season: string; illustration: string;
};

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
  // The viewer's mark-up, attached per request like Package.markup_pct.
  markup_pct?: number;
};

// The number after "from": the floor when the database gives it, the base
// price on the static fallback, nothing when the package has no price.
export const fromPrice = (t: Tile): number | null => customerPrice(t.from_price_cents ?? t.base_price_cents ?? null, t.markup_pct);

// A MARK-UP ON TOP OF THE CONTRACTOR PRICE (Shahar, 2026-09-25; migration
// 237). The package's own numbers - base and lever deltas - are what the
// contractor is paid. The homeowner is shown that plus their mark-up: one
// setting for everyone (config.markup_pct, 15 by default), or their user
// group's override. It is collected as a fee on top (rulebook 52 - we never
// hold the money). The rounding is homeowner_customer_price()'s, to the cent,
// on the TOTAL, so the number on the button is the number on the booking.
export const customerPrice = (cents: number | null, pct: number | null | undefined): number | null =>
  cents == null ? null : cents + Math.round((cents * (pct ?? 0)) / 100);
// One component shown on its own - a base, a lever answer's delta. Display
// only: the price is always the total, marked up once.
export const marked = (pkg: { markup_pct?: number }, cents: number) => Math.round(cents * (1 + (pkg.markup_pct ?? 0) / 100));
// Attach the viewer's mark-up to what the shared read returned.
export const withMarkup = <T extends object>(x: T, pct: number): T & { markup_pct: number } => ({ ...x, markup_pct: pct });

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
// COVERAGE NO LONGER DIMS A TILE (Shahar, 2026-09-20: "these three should not
// be set as disabled, as well as the home internet system").
//
// It used to, and the reasoning was sound at the time: with nobody approved
// to carry the trade, tapping the tile led to an offer that would reach an
// empty room. That stopped being true when the take screen shipped - a
// package with no contractor still has a real way on, the DIY one, with the
// community price kept as the reference. The tile is a live door again.
//
// isCovered still means what it always meant - is there anyone to hand this
// to - and the package page still reads it, which is how turn-key stays off
// the screen when nobody can honour it. What changed is that our supply
// problem is no longer shown to a member as the product's status.
export const isOpen = (t: Tile) => isPriced(t) || isQuote(t);

// Why a tile is dim, in the member's words. Order matters: no price is a
// bigger gap than no contractor, and "coming soon" outranks both.
export function dimReason(t: Tile): string {
  // ONLY A PACKAGE THAT IS ACTUALLY NOT READY says coming soon. The
  // no-contractor case used to land here too and it was the wrong sentence:
  // the package is ready, priced and open - we are the ones missing a
  // tradesman, and a member reading "coming soon" about a water heater they
  // could start this weekend is being told something untrue.
  if (t.availability === "coming_soon") return "Coming soon";
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

export const findPackage = (packages: Package[], code: string) => packages.find((p) => p.code === code) ?? null;

export type Selections = Record<string, string>;

export const defaultSelections = (pkg: Package): Selections =>
  Object.fromEntries(pkg.levers.map((l) => [l.key, (l.options.find((o) => o.is_default) ?? l.options[0]!).key]));

// What the homeowner pays for this configuration: the contractor price
// (homeowner_price) plus the viewer's mark-up.
export const priceFor = (pkg: Package, sel: Selections) => customerPrice(contractorPriceFor(pkg, sel), pkg.markup_pct);
// The basic setup's price, as the homeowner sees it.
export const basePrice = (pkg: Package) => customerPrice(pkg.base_price_cents, pkg.markup_pct);
export const contractorPriceFor = (pkg: Package, sel: Selections) => {
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
    .map((o) => `${o.price_delta_cents > 0 ? "+" : "−"}$${Math.abs(Math.round(marked(pkg, o.price_delta_cents) / 100)).toLocaleString()} for ${o.label}`);

// HOW THE HOMEOWNER PAYS (Shahar, 2026-09-25). The package's payment
// milestones, each a share of the price the homeowner sees, and who each one
// is handed to. Every screen that says when money is due says it from here,
// so the proposal, the Book button and the booked screen cannot disagree.
// The same arithmetic as package_stage_amount (migration 242): a fixed
// installment comes off the top, marked up; percents split what is left;
// the last percent installment takes the rounding.
export type PaymentStep = { key: string; name: string; pct: number | null; cents: number | null; due: string | null };
export function paymentSteps(pkg: Package, price: number | null): PaymentStep[] {
  const pays = pkg.milestones.filter((m) => m.kind === "payment" && (m.percent_of_contract || m.amount_cents));
  const fixed = (m: MilestoneTpl) => (m.amount_cents ? customerPrice(m.amount_cents, pkg.markup_pct) ?? 0 : 0);
  const rest = price == null ? null : price - pays.reduce((a, m) => a + fixed(m), 0);
  const lastPct = pays.filter((m) => m.percent_of_contract).at(-1)?.key;
  let given = 0;
  return pays.map((m) => {
    let cents: number | null;
    if (price == null || rest == null) cents = m.amount_cents ? fixed(m) : null;
    else if (m.amount_cents) cents = fixed(m);
    else if (m.key === lastPct) cents = price - given;
    else cents = Math.round((rest * m.percent_of_contract!) / 100);
    if (cents != null && m.key !== lastPct) given += cents;
    return { key: m.key, name: m.name, pct: m.amount_cents ? null : m.percent_of_contract, cents, due: dueLabel(m) };
  });
}
// "within 3 days of acceptance", or null when it is due on the milestone.
export function dueLabel(m: Pick<MilestoneTpl, "due_days" | "due_from">): string | null {
  const d = m.due_days ?? 0; const from = m.due_from ?? "milestone";
  const when = d === 0 ? "on" : `within ${d} day${d === 1 ? "" : "s"} of`;
  if (from === "accepted") return `${when} acceptance`;
  if (from === "posted") return d === 0 ? "when you book" : `within ${d} day${d === 1 ? "" : "s"} of booking`;
  return d === 0 ? null : `within ${d} day${d === 1 ? "" : "s"}`;
}
type Payee = { collected_by?: "contractor" | "green_bergen" | null };
export const collectsThroughUs = (x: Payee) => x.collected_by === "green_bergen";
export const payeeName = (x: Payee) => (collectsThroughUs(x) ? "Green Bergen" : "your contractor");
// The two ways a job is paid (Shahar, 2026-09-25): the homeowner pays the
// contractor, who pays Green Bergen for the lead; or pays Green Bergen
// upfront, and Green Bergen pays the contractor when they accept the job.
export const payeeLine = (x: Payee) =>
  collectsThroughUs(x) ? "Paid to Green Bergen upfront. Green Bergen pays the contractor when they accept the job." : "Paid to your contractor.";
// "You pay your contractor in steps: 20% at date set, then 80% at floor coated."
export function payPlan(pkg: Package, price: number | null): string {
  const steps = paymentSteps(pkg, price);
  if (collectsThroughUs(pkg)) {
    return `You pay Green Bergen${price != null ? ` ${`$${Math.round(price / 100).toLocaleString()}`}` : ""} upfront, when you book. Green Bergen pays the contractor when they accept the job.`;
  }
  if (steps.length === 0) return `You pay ${payeeName(pkg)} when the work is done.`;
  const parts = steps.map((s) => `${s.pct != null ? `${s.pct}%` : s.cents != null ? `$${Math.round(s.cents / 100).toLocaleString()}` : "a set amount"} at ${s.name.toLowerCase()}${s.due ? ` (${s.due})` : ""}`).join(", then ");
  return `You pay ${payeeName(pkg)} ${steps.length === 1 ? "once" : "in steps"}: ${parts}.`;
}
export const payPlanLine = (pkg: Package, price: number | null) => (collectsThroughUs(pkg) ? payPlan(pkg, price) : `Nothing today. ${payPlan(pkg, price)}`);

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

export type DiyPhase = "prepare" | "gather" | "work" | "finish";
export type DiyStep = { id: string; phase: DiyPhase; step: string; detail: string | null; needs_pro: boolean; is_gate: boolean };
export type DiyList = {
  package: string; name: string; tile_title: string; trade: string | null; requires_permit: boolean;
  suggested_cents: number | null; venmo: string | null; steps: DiyStep[];
};
export const DIY_PHASES: { key: DiyPhase; label: string }[] = [
  { key: "prepare", label: "Before you start" },
  { key: "gather", label: "What you need" },
  { key: "work", label: "The work" },
  { key: "finish", label: "Finish and check" },
];

// Opens the Venmo app on a phone (the web page elsewhere) with the payee,
// the amount and a note filled in.
export const venmoPayLink = (handle: string, cents: number, note: string) =>
  `https://venmo.com/${encodeURIComponent(handle)}?${new URLSearchParams({ txn: "pay", amount: (cents / 100).toFixed(2), note }).toString()}`;
