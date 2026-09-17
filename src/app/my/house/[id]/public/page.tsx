import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { saveHousePage, publishHousePage, pickPhoto, editPhoto } from "./actions";

export const dynamic = "force-dynamic";

// THE HOUSE PAGE, AS ITS OWNER SEES IT.
//
// Shahar (2026-09-17): "This page be configurable by property owner, with
// optional fields such as cost, photos, floor plan, etc."
//
// So this screen is the switchboard, and every switch is a field on the page
// row: what the page IS (a home, for sale, for rent), what it says, what it
// costs, which sections exist at all, how much of the address a stranger
// sees, and which of the job's photographs are on it.
//
// DRAFT UNTIL PUBLISHED (his choice). The page exists from the day the house
// does and answers nothing until the button at the top is pressed, so nobody's
// home address becomes a public URL because they signed up. Publishing this
// page is NOT the same as Green Bergen listing the house on its front door -
// that is projects.showcase, ours to set, and it is shown here as a fact
// rather than a switch.
type Photo = {
  id: string; file_id: string | null; path: string; kind: string;
  caption: string | null; sort: number; is_cover: boolean;
};
type Pickable = {
  file_id: string; name: string; caption: string | null; bucket: string; path: string;
  taken_at: string | null; kind: string | null; on_page: boolean;
};
type Page = {
  purpose: string; headline: string | null; body: string | null;
  price: number | null; price_note: string | null;
  beds: number | null; baths: number | null; total_sqft: number | null; lot_size: string | null;
  built_year: number | null; available_from: string | null; features: string[] | null;
  contact_name: string | null; contact_phone: string | null; contact_email: string | null;
  show_address: boolean | null; address_display: string | null; is_published: boolean | null;
  show_price: boolean | null; show_facts: boolean | null; show_plans: boolean | null;
  show_build: boolean | null; show_form: boolean | null;
  scope_note: string | null; garage_note: string | null; updated_at: string | null;
};
type Mine = {
  project_id: string; house: string; address: string | null; slug: string | null; url: string | null;
  on_front_door: boolean; page: Page | null; photos: Photo[]; pickable: Pickable[];
};

const PURPOSES = [
  { v: "home", say: "Just a page about the house" },
  { v: "for sale", say: "For sale" },
  { v: "for rent", say: "For rent" },
  { v: "sold", say: "Sold" },
  { v: "rented", say: "Rented" },
];
const ADDRESS = [
  { v: "street and town", say: "Street and town — 55 Walnut Drive, Tenafly" },
  { v: "town only", say: "The town only — Tenafly" },
  { v: "full", say: "The whole address, state and all" },
  { v: "hidden", say: "No address at all" },
];
const KINDS = ["photo", "floor plan", "elevation", "site plan"];

export default async function HousePageEditor({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; pick?: string }>;
}) {
  const { id } = await params;
  const { ok, error, pick } = await searchParams;
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect(`/login?next=${encodeURIComponent(`/my/house/${id}/public`)}`);

  const { data } = await supabase.rpc("house_page_mine", { p_project: id });
  const mine = (data ?? null) as Mine | null;
  // house_page_mine returns nothing at all for a project that is not a house
  // or is not yours to edit, so an empty read and a refusal look the same.
  if (!mine) notFound();
  const page = mine.page;
  const market = page?.purpose === "for sale" || page?.purpose === "for rent";

  // The published copies are public URLs; the job's own photographs are in a
  // private bucket and need signing to be looked at here.
  const pubBase = supabase.storage.from("public-media").getPublicUrl("").data.publicUrl.replace(/\/$/, "");
  const picker = mine.pickable.slice(0, 48);
  const thumbs = new Map<string, string>();
  const byBucket = new Map<string, string[]>();
  for (const p of picker) byBucket.set(p.bucket, [...(byBucket.get(p.bucket) ?? []), p.path]);
  for (const [bucket, paths] of byBucket) {
    const { data: signed } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
    for (const row of signed ?? []) if (row.path && row.signedUrl) thumbs.set(row.path, row.signedUrl);
  }

  const live = page?.is_published === true;
  const onPage = mine.photos.filter((p) => p.kind === "photo");
  const plans = mine.photos.filter((p) => p.kind !== "photo");

  return (
    <div className="page">
      <SiteHeader right={<Link href={`/my/house/${id}`} className="iconlink">Back to the house</Link>} />
      <main className="wrap" style={{ flex: 1, width: "100%", maxWidth: 760, paddingBottom: 48 }}>
        <h1 style={{ fontSize: "clamp(22px, 3.6vw, 28px)", margin: "8px 0 2px" }}>The page for {mine.house}</h1>
        <p className="muted small" style={{ margin: "0 0 14px" }}>
          {mine.address ?? "No address on the house yet"}
        </p>

        {error && <p className="error" style={{ margin: "0 0 12px" }}>{error}</p>}
        {ok === "saved" && <p className="small" style={{ margin: "0 0 12px" }}>Saved.</p>}
        {ok === "live" && <p className="small" style={{ margin: "0 0 12px" }}>The page is live. Anybody with the link can read it.</p>}
        {ok === "draft" && <p className="small" style={{ margin: "0 0 12px" }}>Back to a draft. The link answers nothing now.</p>}
        {ok === "photo" && <p className="small" style={{ margin: "0 0 12px" }}>Done.</p>}
        {ok === "dropped" && <p className="small" style={{ margin: "0 0 12px" }}>Taken off the page, and the public copy deleted.</p>}

        {/* LIVE OR NOT, and the link. */}
        <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span className={`lst-tag ${live ? "sale" : "rent"}`}>{live ? "Live" : "Draft"}</span>
            <span className="grow small" style={{ flex: 1, minWidth: 180 }}>
              {live
                ? <>Anybody with the link can read it. {mine.url && <Link href={mine.url} style={{ fontWeight: 700 }}>Open it →</Link>}</>
                : "Nobody can read it yet. Nothing is public until you press the button."}
            </span>
            <form action={publishHousePage.bind(null, id)}>
              <input type="hidden" name="on" value={live ? "0" : "1"} />
              <button className="btn">{live ? "Take it down" : "Publish it"}</button>
            </form>
          </div>
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            {mine.url ? <>Its address is <code>{mine.url}</code>.</> : "It has no address yet."}
            {mine.on_front_door
              ? " Green Bergen also lists this house on its own front door."
              : " It is not listed on Green Bergen's front door — publishing here does not put it there."}
          </p>
        </div>

        {/* WHAT THE PAGE IS, AND WHAT IT SAYS. */}
        <form action={saveHousePage.bind(null, id)} className="card" style={{ marginBottom: 14, padding: "16px 20px", display: "grid", gap: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>What this page is</h2>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="purpose">The house is</label>
            <select id="purpose" name="purpose" className="input" defaultValue={page?.purpose ?? "home"}>
              {PURPOSES.map((p) => <option key={p.v} value={p.v}>{p.say}</option>)}
            </select>
          </div>
          <p className="muted small" style={{ margin: "-6px 0 0" }}>
            For sale or for rent gives the page a price, an availability date and the form that
            collects buyers and renters. The other three have no price and no form.
          </p>

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="headline">Headline</label>
            <input id="headline" name="headline" className="input" defaultValue={page?.headline ?? ""}
              placeholder="A 1929 colonial, taken back to the studs" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="body">The description</label>
            <textarea id="body" name="body" className="input" rows={7} defaultValue={page?.body ?? ""}
              placeholder={"Write it the way you would say it standing in the hall.\n\nWhat somebody walking in notices first, what was done to it, what the street is like."} />
          </div>

          <h2 className="section-title" style={{ margin: "6px 0 0" }}>The number</h2>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="price">{page?.purpose === "for rent" ? "Rent" : "Asking price"}</label>
              <input id="price" name="price" className="input" inputMode="decimal"
                defaultValue={page?.price != null ? String(Math.round(page.price)) : ""} placeholder="1,250,000" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="price_note">Said how</label>
              <input id="price_note" name="price_note" className="input" defaultValue={page?.price_note ?? ""}
                placeholder={page?.purpose === "for rent" ? "per month" : "asking"} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="available_from">Available from</label>
            <input id="available_from" name="available_from" type="date" className="input"
              defaultValue={page?.available_from ?? ""} />
          </div>
          {!market && (
            <p className="muted small" style={{ margin: "-6px 0 0" }}>
              Kept, but not shown while the house is not for sale or for rent.
            </p>
          )}

          <h2 className="section-title" style={{ margin: "6px 0 0" }}>The facts</h2>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="beds">Bedrooms</label>
              <input id="beds" name="beds" className="input" inputMode="decimal" defaultValue={page?.beds ?? ""}
                placeholder="left empty, counted from the rooms" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="baths">Bathrooms</label>
              <input id="baths" name="baths" className="input" inputMode="decimal" defaultValue={page?.baths ?? ""}
                placeholder="6.5" />
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="sqft">Square feet</label>
              <input id="sqft" name="sqft" className="input" inputMode="numeric" defaultValue={page?.total_sqft ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="lot_size">The lot</label>
              <input id="lot_size" name="lot_size" className="input" defaultValue={page?.lot_size ?? ""}
                placeholder="0.34 acre" />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="built_year">Built</label>
            <input id="built_year" name="built_year" className="input" inputMode="numeric"
              defaultValue={page?.built_year ?? ""} placeholder="1929" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="features">What comes with it</label>
            <textarea id="features" name="features" className="input" rows={3}
              defaultValue={(page?.features ?? []).join("\n")}
              placeholder={"One per line: pool, finished basement, two-car garage"} />
          </div>

          <h2 className="section-title" style={{ margin: "6px 0 0" }}>How much of the address</h2>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="address_display">A stranger sees</label>
            <select id="address_display" name="address_display" className="input"
              defaultValue={page?.address_display ?? (page?.show_address === false ? "town only" : "street and town")}>
              {ADDRESS.map((a) => <option key={a.v} value={a.v}>{a.say}</option>)}
            </select>
          </div>

          <h2 className="section-title" style={{ margin: "6px 0 0" }}>Which sections exist</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {[
              { n: "show_price", say: "The price", on: page?.show_price !== false },
              { n: "show_facts", say: "The facts — beds, baths, square feet, the lot", on: page?.show_facts !== false },
              { n: "show_plans", say: "Floor plans and elevations", on: page?.show_plans !== false },
              { n: "show_build", say: "That it is being built, and the link to follow it", on: page?.show_build !== false },
              { n: "show_form", say: "The form that collects buyers and renters", on: page?.show_form !== false },
            ].map((s) => (
              <label key={s.n} className="radio-opt" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" name={s.n} defaultChecked={s.on} />
                {s.say}
              </label>
            ))}
          </div>

          <h2 className="section-title" style={{ margin: "6px 0 0" }}>Who to ask for</h2>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="contact_name">Name</label>
              <input id="contact_name" name="contact_name" className="input" defaultValue={page?.contact_name ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="contact_phone">Phone</label>
              <input id="contact_phone" name="contact_phone" className="input" defaultValue={page?.contact_phone ?? ""} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="contact_email">Email</label>
            <input id="contact_email" name="contact_email" className="input" defaultValue={page?.contact_email ?? ""} />
          </div>

          <div>
            <button className="btn">Save the page</button>
            <span className="muted small" style={{ marginLeft: 10 }}>
              An empty box leaves what is there alone.
            </span>
          </div>
        </form>

        {/* THE PHOTOGRAPHS ON THE PAGE. */}
        <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            On the page · {onPage.length} photograph{onPage.length === 1 ? "" : "s"}
            {plans.length > 0 && ` · ${plans.length} plan${plans.length === 1 ? "" : "s"}`}
          </h2>
          {mine.photos.length === 0 && (
            <p className="muted small" style={{ margin: "8px 0 0" }}>
              Nothing yet. Pick from the job&apos;s photographs below — the first one you pick becomes the cover.
            </p>
          )}
          <div className="hp-grid" style={{ marginTop: 10 }}>
            {mine.photos.map((ph, i) => (
              <div key={ph.id} className="hp-cell">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${pubBase}/${ph.path}`} alt={ph.caption ?? ph.kind} />
                <div className="hp-row">
                  {ph.is_cover && <span className="hp-flag">cover</span>}
                  {ph.kind !== "photo" && <span className="hp-flag alt">{ph.kind}</span>}
                </div>
                <form action={editPhoto.bind(null, id, ph.id)} className="hp-acts">
                  <input type="hidden" name="move" value="-1" />
                  <button className="hp-btn" aria-label="Earlier" disabled={i === 0}>←</button>
                </form>
                <form action={editPhoto.bind(null, id, ph.id)} className="hp-acts b">
                  <input type="hidden" name="move" value="1" />
                  <button className="hp-btn" aria-label="Later">→</button>
                </form>
                <div className="hp-under">
                  {!ph.is_cover && ph.kind === "photo" && (
                    <form action={editPhoto.bind(null, id, ph.id)}>
                      <input type="hidden" name="cover" value="1" />
                      <button className="hp-link">Make it the cover</button>
                    </form>
                  )}
                  <form action={editPhoto.bind(null, id, ph.id)}>
                    <input type="hidden" name="drop" value="1" />
                    <button className="hp-link danger">Take it off</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* THE JOB'S OWN PHOTOGRAPHS, TO PICK FROM. */}
        <div className="card" style={{ padding: "16px 20px" }}>
          <h2 className="section-title" style={{ margin: 0 }}>The job&apos;s photographs</h2>
          <p className="muted small" style={{ margin: "6px 0 10px" }}>
            Everything photographed on this house and the jobs beneath it. Picking one publishes a copy;
            the original stays private.
          </p>
          {picker.length === 0 && <p className="muted small" style={{ margin: 0 }}>No photographs on this house yet.</p>}
          <div className="hp-grid">
            {picker.map((f) => {
              const url = thumbs.get(f.path);
              const open = pick === f.file_id;
              return (
                <div key={f.file_id} className={`hp-cell${f.on_page ? " used" : ""}`}>
                  {url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={url} alt={f.caption ?? f.name} />
                    : <div className="hp-blank">{f.name}</div>}
                  {f.on_page && <div className="hp-row"><span className="hp-flag">on the page</span></div>}
                  {!open && !f.on_page && (
                    <div className="hp-under">
                      <Link href={`/my/house/${id}/public?pick=${f.file_id}`} className="hp-link" scroll={false}>Put it on the page</Link>
                    </div>
                  )}
                  {open && (
                    <form action={pickPhoto.bind(null, id)} className="hp-pick">
                      <input type="hidden" name="file_id" value={f.file_id} />
                      <input type="hidden" name="bucket" value={f.bucket} />
                      <input type="hidden" name="path" value={f.path} />
                      <select name="kind" className="input" defaultValue="photo" aria-label="What this picture is">
                        {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                      <input name="caption" className="input" placeholder="Caption (optional)"
                        defaultValue={f.caption ?? ""} />
                      <button className="btn">Put it on</button>
                      <Link href={`/my/house/${id}/public`} className="hp-link" scroll={false}>Cancel</Link>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
