import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteRow, savePackage, saveRow } from "../actions";
import { PackagePhoto } from "./PackagePhoto";

export const dynamic = "force-dynamic";

// ONE PACKAGE, EVERYTHING IT IS. Top to bottom in the order a homeowner
// meets it: what it is and what the basic setup costs; the scope lines the
// basic setup includes; the levers whose answers add an upgrade at its
// cost; the photos we ask for; the progress line; and who has signed up
// to serve it. Every row is its own small form - save one thing at a time,
// which is how a price list is actually maintained.
type StoreLink = { label: string; url: string };
type Item = { id: string; label: string; detail: string | null; kind: string; sort_order: number; links: StoreLink[] };
const ITEM_KINDS: [string, string][] = [["work", "Work"], ["assurance", "Assurance"], ["hardware", "Hardware (you buy)"]];
const storeUrl = (links: StoreLink[] | null | undefined, label: string) => links?.find((l) => l.label === label)?.url ?? "";
type Option = { id: string; key: string; label: string; chip: string | null; price_delta_cents: number; is_default: boolean; sort_order: number };
type Lever = { id: string; key: string; label: string; control: string; question: string | null; sort_order: number; options: Option[] };
type Photo = { id: string; key: string; label: string; hint: string | null; sort_order: number };
type Milestone = { id: string; key: string; kind: string; name: string; sequence_no: number; percent_of_contract: number | null; typical_range: string | null; trigger_description: string | null };
type Server = { contact_id: string; name: string; status: string; price_cents: number | null; note: string | null; updated_at: string };
type Video = { id: string; label: string; url: string; sort_order: number; is_active: boolean; shown: number; plays: number; completes: number; booked: number };
type Pkg = {
  code: string; name: string; tile_title: string; tile_line2: string | null; trade: string; tile_group: string;
  availability: string; base_price_cents: number | null; config_label: string | null; requires_permit: boolean;
  permit_deposit_pct: number | null; instant_book: boolean; approval_note: string | null; illustration: string | null;
  description: string | null; sort_order: number; is_active: boolean; category: string | null; season_months: number[] | null;
  photo_url: string | null; promote: boolean;
  covered: boolean; items: Item[]; levers: Lever[]; photos: Photo[]; milestones: Milestone[]; contractors: Server[]; videos: Video[];
};

const dollars = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(c % 100 === 0 ? 0 : 2));
const signed = (c: number) => (c === 0 ? "included" : `${c > 0 ? "+" : "−"}$${(Math.abs(c) / 100).toLocaleString("en-US")}`);
const AVAIL = [["priced", "Priced - bookable at the community price"], ["quote", "Quote - a person looks first"], ["custom", "Custom - describe it"], ["coming_soon", "Coming soon - not bookable"]];
const M_KINDS = ["booked", "accepted", "payment", "task", "done"];

// Module-level, not created in render (the lint is right: a component made
// inside a component remounts every time).
// A field in a row. Rows WRAP (see .pk-row in globals.css) rather than
// squeezing twelve columns into whatever width the window has - on a phone
// the old grid left each input two characters wide (Shahar: "fix the font
// size, this is not a nice design"). A field's width is a hint: narrow for
// an order number, wide for a sentence, full for a line of its own; the
// old span numbers map onto those so every row keeps its shape.
type W = "narrow" | "" | "wide" | "full";
const widthOf = (span: number): W => (span >= 12 ? "full" : span >= 5 ? "wide" : span <= 1 ? "narrow" : "");
function F({ label, children, span = 2, w }: { label: string; children: React.ReactNode; span?: number; w?: W }) {
  return <label className={`pk-f ${w ?? widthOf(span)}`}><span>{label}</span>{children}</label>;
}
function Hidden({ code, kind, id, parent }: { code: string; kind: string; id?: string; parent?: string }) {
  return (
    <>
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="kind" value={kind} />
      {id && <input type="hidden" name="id" value={id} />}
      {parent && <input type="hidden" name="parent" value={parent} />}
    </>
  );
}
// The remove button lives INSIDE the row's own form and points it at
// deleteRow through formAction. It used to be a form of its own nested in
// the row's form, which HTML does not allow: the browser dropped the inner
// form and the X quietly submitted the outer one - Save (Shahar: "the X
// does not remove the line"). The row's hidden code, kind and id are what
// deleteRow reads, so nothing else is needed.
function Del({ title = "Remove" }: { title?: string }) {
  return <button formAction={deleteRow} className="btn ghost" title={title} aria-label={title}>✕</button>;
}

export default async function AdminPackagePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { code } = await params;
  const { error, saved } = await searchParams;
  const supabase = await createClient();
  const [{ data: me }, { data }, { data: trades }, { data: cats }] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("admin_package", { p_code: code }),
    supabase.from("trades").select("trade").order("sort_order"),
    supabase.from("blueprint_package_categories").select("key, label").order("sort_order"),
  ]);
  if (!me?.is_superadmin) {
    return <main className="wrap" style={{ paddingTop: 48, maxWidth: 560 }}><h1>Packages</h1><p className="muted">This area is for administrators.</p></main>;
  }
  if (!data) notFound();
  const p = data as Pkg;
  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96 }}>
      <p className="small"><Link href="/admin/packages">&larr; All packages</Link></p>
      <span className="kicker">Package · {p.trade}{p.covered ? "" : " · nobody approved carries this trade"}</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>{p.name}</h1>
      {error && <p className="card" style={{ borderLeft: "4px solid #c0262d" }}>{error}</p>}
      {saved && <p className="card" style={{ borderLeft: "4px solid var(--brand)" }}>{saved}</p>}

      {/* 1. THE PACKAGE AND ITS BASIC SETUP */}
      <div className="card" id="package">
        <h2 className="section-title">The basic setup</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          The base price is what the default configuration costs, services and hardware together. The configuration line says in words what that default is - it is what the homeowner reads next to the price.
        </p>
        <form action={savePackage} className="pk-row first">
          <input type="hidden" name="code" value={p.code} />
          <F label="Name" w="wide"><input className="input" name="name" defaultValue={p.name} required /></F>
          <F label="Tile title" span={2}><input className="input" name="tile_title" defaultValue={p.tile_title} required /></F>
          <F label="Tile second line" w=""><input className="input" name="tile_line2" defaultValue={p.tile_line2 ?? ""} /></F>
          <F label="Base price ($)" span={2}><input className="input" name="base_price" inputMode="decimal" defaultValue={dollars(p.base_price_cents)} placeholder="1180" /></F>
          <F label="State" span={2}>
            <select className="input" name="availability" defaultValue={p.availability}>{AVAIL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </F>
          <F label="Trade" span={2}>
            <select className="input" name="trade" defaultValue={p.trade}>{(trades ?? []).map((t) => <option key={t.trade} value={t.trade}>{t.trade}</option>)}</select>
          </F>
          <F label="Configuration line (what the base price buys)" w="full"><input className="input" name="config_label" defaultValue={p.config_label ?? ""} placeholder="22 kW whole-house, natural gas, transfer switch, pad" /></F>
          <F label="Description" w="full"><textarea className="input" name="description" rows={2} defaultValue={p.description ?? ""} /></F>
          <F label="Shelf" span={2}>
            <select className="input" name="tile_group" defaultValue={p.tile_group}><option value="front">Front page</option><option value="more">More packages</option></select>
          </F>
          <F label="Section" span={2}>
            <select className="input" name="category" defaultValue={p.category ?? ""}><option value="">—</option>{(cats ?? []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          </F>
          <F label="Order" w="narrow"><input className="input" name="sort_order" inputMode="numeric" defaultValue={p.sort_order} /></F>
          <F label="Illustration" w=""><input className="input" name="illustration" defaultValue={p.illustration ?? ""} /></F>
          <F label="Season months (e.g. 10,11; blank = all year)" span={2}><input className="input" name="season_months" defaultValue={(p.season_months ?? []).join(",")} /></F>
          <F label="Permit deposit %" w="narrow"><input className="input" name="permit_deposit_pct" inputMode="decimal" defaultValue={p.permit_deposit_pct ?? ""} /></F>
          <F label="Approval note" w="wide"><input className="input" name="approval_note" defaultValue={p.approval_note ?? ""} /></F>
          {/* THE FRONT DOOR (052). A photograph of the work - a professional
              at it, in a house - shown large on the homeowner landing page
              when this package is promoted. Uploaded from here, shrunk in
              the browser, saved on its own (not part of this form). */}
          <PackagePhoto code={p.code} url={p.photo_url} />
          <div className="pk-f full" style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
            <label className="small"><input type="checkbox" name="promote" defaultChecked={p.promote} /> Feature on the landing page</label>
            <label className="small"><input type="checkbox" name="requires_permit" defaultChecked={p.requires_permit} /> Needs a permit</label>
            <label className="small"><input type="checkbox" name="instant_book" defaultChecked={p.instant_book} /> Instant book</label>
            <label className="small"><input type="checkbox" name="is_active" defaultChecked={p.is_active} /> Active (off retires it everywhere)</label>
            <button className="btn" style={{ marginLeft: "auto" }}>Save the package</button>
          </div>
        </form>
      </div>

      {/* 2. SCOPE LINES */}
      <div className="card" id="item" style={{ marginTop: 14 }}>
        <h2 className="section-title">What the basic setup includes</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Work lines are what gets done; assurance lines are what comes with it (insurance, warranty). A DIY project shows the work lines as its steps.
          <strong> Hardware</strong> lines are what the homeowner buys and the price does not include - the generator, the switch, the pad - each with the suggested product page at Home Depot and Lowe&apos;s; the package page lists them under &ldquo;What you buy&rdquo;.
        </p>
        {p.items.map((it) => (
          <form key={it.id} action={saveRow} className="pk-row">
            <Hidden code={p.code} kind="item" id={it.id} />
            <F label="Line" span={5}><input className="input" name="label" defaultValue={it.label} required /></F>
            <F label="Detail" span={3}><input className="input" name="detail" defaultValue={it.detail ?? ""} /></F>
            <F label="Kind" span={2}><select className="input" name="row_kind" defaultValue={it.kind}>{ITEM_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></F>
            <F label="Order"><input className="input" name="sort_order" inputMode="numeric" defaultValue={it.sort_order} /></F>
            <div className="pk-acts"><button className="btn">Save</button><Del /></div>
            <F label="Home Depot page (hardware only)" span={6}><input className="input" name="link_home_depot" type="url" defaultValue={storeUrl(it.links, "Home Depot")} placeholder="https://www.homedepot.com/p/…" /></F>
            <F label="Lowe's page (hardware only)" span={6}><input className="input" name="link_lowes" type="url" defaultValue={storeUrl(it.links, "Lowe's")} placeholder="https://www.lowes.com/pd/…" /></F>
          </form>
        ))}
        <form action={saveRow} className="pk-row">
          <Hidden code={p.code} kind="item" />
          <F label="New line" span={5}><input className="input" name="label" placeholder="Underground gas line from the meter" required /></F>
          <F label="Detail" span={3}><input className="input" name="detail" /></F>
          <F label="Kind" span={2}><select className="input" name="row_kind" defaultValue="work">{ITEM_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></F>
          <F label="Order"><input className="input" name="sort_order" inputMode="numeric" defaultValue={(p.items.at(-1)?.sort_order ?? 0) + 10} /></F>
          <div><button className="btn">Add</button></div>
          <F label="Home Depot page (hardware only)" span={6}><input className="input" name="link_home_depot" type="url" placeholder="https://www.homedepot.com/p/…" /></F>
          <F label="Lowe's page (hardware only)" span={6}><input className="input" name="link_lowes" type="url" placeholder="https://www.lowes.com/pd/…" /></F>
        </form>
      </div>

      {/* 3. LEVERS AND OPTIONS */}
      <div className="card" id="lever" style={{ marginTop: 14 }}>
        <h2 className="section-title">Levers - the upgrades, at cost</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Each lever is one question. Its default answer is the basic setup at +$0; every other answer changes the price by its delta - a longer run, a bigger unit, propane, the contractor supplying the hardware. An add-on that is simply on or off is a two-answer lever (No / Yes). Segment shows the answers side by side; Radio lists them.
        </p>
        {p.levers.map((lv) => (
          <div key={lv.id} style={{ border: "1px solid #e6e6e2", borderRadius: 10, padding: "8px 12px", marginTop: 10 }}>
            <form action={saveRow} className="pk-row first">
              <Hidden code={p.code} kind="lever" id={lv.id} />
              <F label="Key" span={2}><input className="input" name="key" defaultValue={lv.key} pattern="[a-z0-9_]{1,30}" required /></F>
              <F label="Label" span={2}><input className="input" name="label" defaultValue={lv.label} required /></F>
              <F label="The question the homeowner is asked" span={5}><input className="input" name="question" defaultValue={lv.question ?? ""} /></F>
              <F label="Control"><select className="input" name="control" defaultValue={lv.control}><option value="seg">Segment</option><option value="radio">Radio</option></select></F>
              <F label="Order"><input className="input" name="sort_order" inputMode="numeric" defaultValue={lv.sort_order} /></F>
              <div className="pk-acts"><button className="btn">Save</button>
                <Del title="Remove the lever and its options" /></div>
            </form>
            <div style={{ paddingLeft: 18 }}>
              {lv.options.map((o) => (
                <form key={o.id} action={saveRow} className="pk-row">
                  <Hidden code={p.code} kind="option" id={o.id} parent={lv.id} />
                  <F label="Key" span={2}><input className="input" name="key" defaultValue={o.key} pattern="[a-z0-9_]{1,30}" required /></F>
                  <F label="Answer" span={3}><input className="input" name="label" defaultValue={o.label} required /></F>
                  <F label="Chip (short)" span={2}><input className="input" name="chip" defaultValue={o.chip ?? ""} /></F>
                  <F label={`Price change ($) · ${signed(o.price_delta_cents)}`} span={2}><input className="input" name="price_delta" inputMode="decimal" defaultValue={dollars(o.price_delta_cents)} /></F>
                  <F label="Order"><input className="input" name="sort_order" inputMode="numeric" defaultValue={o.sort_order} /></F>
                  <label className="small" style={{ paddingBottom: 8 }}><input type="checkbox" name="is_default" defaultChecked={o.is_default} /> default</label>
                  <div className="pk-acts"><button className="btn">Save</button><Del /></div>
                </form>
              ))}
              <form action={saveRow} className="pk-row">
                <Hidden code={p.code} kind="option" parent={lv.id} />
                <F label="New answer key" span={2}><input className="input" name="key" pattern="[a-z0-9_]{1,30}" placeholder="underground" required /></F>
                <F label="Answer" span={3}><input className="input" name="label" placeholder="Underground piping" required /></F>
                <F label="Chip" span={2}><input className="input" name="chip" /></F>
                <F label="Price change ($, negative for a saving)" span={2}><input className="input" name="price_delta" inputMode="decimal" placeholder="850" /></F>
                <F label="Order"><input className="input" name="sort_order" inputMode="numeric" defaultValue={(lv.options.at(-1)?.sort_order ?? 0) + 10} /></F>
                <label className="small" style={{ paddingBottom: 8 }}><input type="checkbox" name="is_default" /> default</label>
                <div><button className="btn">Add</button></div>
              </form>
            </div>
          </div>
        ))}
        <form action={saveRow} className="pk-row" style={{ marginTop: 10 }}>
          <Hidden code={p.code} kind="lever" />
          <F label="New lever key" span={2}><input className="input" name="key" pattern="[a-z0-9_]{1,30}" placeholder="piping" required /></F>
          <F label="Label" span={2}><input className="input" name="label" placeholder="Gas piping" required /></F>
          <F label="Question" span={5}><input className="input" name="question" placeholder="Above ground along the wall, or buried?" /></F>
          <F label="Control"><select className="input" name="control" defaultValue="seg"><option value="seg">Segment</option><option value="radio">Radio</option></select></F>
          <F label="Order"><input className="input" name="sort_order" inputMode="numeric" defaultValue={(p.levers.at(-1)?.sort_order ?? 0) + 10} /></F>
          <div><button className="btn">Add lever</button></div>
        </form>
      </div>

      {/* 4. PHOTOS */}
      <div className="card" id="photo" style={{ marginTop: 14 }}>
        <h2 className="section-title">Photos we ask for</h2>
        <p className="muted small" style={{ marginTop: 0 }}>What the homeowner photographs so a contractor can confirm the price without a visit.</p>
        {p.photos.map((ph) => (
          <form key={ph.id} action={saveRow} className="pk-row">
            <Hidden code={p.code} kind="photo" id={ph.id} />
            <F label="Key" span={2}><input className="input" name="key" defaultValue={ph.key} required /></F>
            <F label="Label" span={3}><input className="input" name="label" defaultValue={ph.label} required /></F>
            <F label="Hint" span={5}><input className="input" name="hint" defaultValue={ph.hint ?? ""} /></F>
            <F label="Order"><input className="input" name="sort_order" inputMode="numeric" defaultValue={ph.sort_order} /></F>
            <div className="pk-acts"><button className="btn">Save</button><Del /></div>
          </form>
        ))}
        <form action={saveRow} className="pk-row">
          <Hidden code={p.code} kind="photo" />
          <F label="New key" span={2}><input className="input" name="key" placeholder="meter" required /></F>
          <F label="Label" span={3}><input className="input" name="label" placeholder="Gas meter" required /></F>
          <F label="Hint" span={5}><input className="input" name="hint" /></F>
          <F label="Order"><input className="input" name="sort_order" inputMode="numeric" defaultValue={(p.photos.at(-1)?.sort_order ?? 0) + 10} /></F>
          <div><button className="btn">Add</button></div>
        </form>
      </div>

      {/* 5. MILESTONES */}
      <div className="card" id="milestone" style={{ marginTop: 14 }}>
        <h2 className="section-title">The progress line</h2>
        <p className="muted small" style={{ marginTop: 0 }}>Booked and accepted are derived; payment nodes carry a percent of the contract; task nodes are hand-marked (permit issued, inspection passed). Changes apply to new bookings only.</p>
        {p.milestones.map((m) => (
          <form key={m.id} action={saveRow} className="pk-row">
            <Hidden code={p.code} kind="milestone" id={m.id} />
            <F label="#"><input className="input" name="sequence_no" inputMode="numeric" defaultValue={m.sequence_no} /></F>
            <F label="Key" span={2}><input className="input" name="key" defaultValue={m.key} required /></F>
            <F label="Kind"><select className="input" name="row_kind" defaultValue={m.kind}>{M_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></F>
            <F label="Name" span={3}><input className="input" name="name" defaultValue={m.name} required /></F>
            <F label="% of contract"><input className="input" name="percent_of_contract" inputMode="decimal" defaultValue={m.percent_of_contract ?? ""} /></F>
            <F label="Typical range" span={2}><input className="input" name="typical_range" defaultValue={m.typical_range ?? ""} /></F>
            <div className="pk-acts"><button className="btn">Save</button><Del /></div>
            <F label="What triggers it" span={12}><input className="input" name="trigger_description" defaultValue={m.trigger_description ?? ""} /></F>
          </form>
        ))}
        <form action={saveRow} className="pk-row">
          <Hidden code={p.code} kind="milestone" />
          <F label="#"><input className="input" name="sequence_no" inputMode="numeric" defaultValue={(p.milestones.at(-1)?.sequence_no ?? 0) + 1} /></F>
          <F label="Key" span={2}><input className="input" name="key" placeholder="rough_in" required /></F>
          <F label="Kind"><select className="input" name="row_kind" defaultValue="task">{M_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></F>
          <F label="Name" span={3}><input className="input" name="name" placeholder="Rough-in inspected" required /></F>
          <F label="% of contract"><input className="input" name="percent_of_contract" inputMode="decimal" /></F>
          <F label="Typical range" span={2}><input className="input" name="typical_range" /></F>
          <div className="pk-acts"><button className="btn">Add</button></div>
        </form>
      </div>

      {/* 5b. THE VIDEO, IN VERSIONS */}
      <div className="card" id="video" style={{ marginTop: 14 }}>
        <h2 className="section-title">The explainer video</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Shown in the second half of the package screen. Add more than one active version and each viewer is assigned one, the same one every visit;
          the numbers say which version earns the play, the finish and the booking within fourteen days. A YouTube link embeds; any other https link plays as a file.
        </p>
        {p.videos.map((v) => {
          const pct = (n: number) => (v.shown ? `${Math.round((n / v.shown) * 100)}%` : "—");
          return (
            <form key={v.id} action={saveRow} className="pk-row">
              <Hidden code={p.code} kind="video" id={v.id} />
              <F label="Version" span={2}><input className="input" name="label" defaultValue={v.label} required /></F>
              <F label="Link (YouTube or a video file)" span={5}><input className="input" name="url" type="url" defaultValue={v.url} required /></F>
              <F label="Order"><input className="input" name="sort_order" inputMode="numeric" defaultValue={v.sort_order} /></F>
              <label className="small" style={{ paddingBottom: 8 }}><input type="checkbox" name="is_active" defaultChecked={v.is_active} /> on</label>
              <div className="pk-acts"><button className="btn">Save</button><Del /></div>
              <p className="muted small pk-f full" style={{ margin: 0 }}>
                Shown to {v.shown} · played {v.plays} ({pct(v.plays)}) · watched to the end {v.completes} ({pct(v.completes)}) · booked within 14 days {v.booked} ({pct(v.booked)})
              </p>
            </form>
          );
        })}
        <form action={saveRow} className="pk-row">
          <Hidden code={p.code} kind="video" />
          <F label="New version" span={2}><input className="input" name="label" placeholder="A - Shahar explains" required /></F>
          <F label="Link" span={5}><input className="input" name="url" type="url" placeholder="https://youtu.be/…" required /></F>
          <F label="Order"><input className="input" name="sort_order" inputMode="numeric" defaultValue={(p.videos.at(-1)?.sort_order ?? 0) + 10} /></F>
          <label className="small" style={{ paddingBottom: 8 }}><input type="checkbox" name="is_active" defaultChecked /> on</label>
          <div className="pk-acts"><button className="btn">Add</button></div>
        </form>
      </div>

      {/* 6. WHO SERVES IT */}
      <div className="card" id="servers" style={{ marginTop: 14 }}>
        <h2 className="section-title">Contractors serving this package · {p.contractors.filter((c) => c.status === "active").length}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>Who has signed up from the Professionals app, and the price they call for the basic setup when it differs from the community price. The lowest call below the community price gets first refusal on new jobs for the window set in config (first_refusal_hours); the homeowner always pays the community price.</p>
        {p.contractors.length === 0 && <p className="muted small">Nobody yet.</p>}
        {p.contractors.length > 0 && (
          <table className="tasktable"><thead><tr><th>Contractor</th><th>Status</th><th style={{ textAlign: "right" }}>Their price</th><th>Note</th></tr></thead>
            <tbody>{p.contractors.map((c) => (
              <tr key={c.contact_id}><td>{c.name}</td><td>{c.status}</td><td style={{ textAlign: "right" }}>{c.price_cents == null ? <span className="muted">community price</span> : `$${dollars(c.price_cents)}`}</td><td className="muted small">{c.note}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </main>
  );
}
