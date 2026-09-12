import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe, outstanding } from "@/lib/me";
import { AppBar, Card, ChevronIcon, DoorSwitch, Notice, Screen } from "@shared/ui";
import { loadDoors } from "@shared/doors.server";
import { DefaultDoor } from "@shared/DefaultDoor";
import { InviteForm } from "@shared/invite/InviteForm";
import { saveBusiness, signOut } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your business" };

// Behind the gear: the business itself, then the way to the trades and the
// documents, then the way out. Everything here is the contractor's own
// record - contractor_business_save finds the company through their
// contact, so there is no company id to tamper with.
export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; token?: string; who?: string; kind?: string }> }) {
  const { ok, error, token, who, kind } = await searchParams;
  // Neither depends on the other, so they leave together.
  const [me, doors] = await Promise.all([getMe(), loadDoors()]);
  if (!me.signed_in) redirect("/login?next=/business");
  const c = me.company;
  const left = outstanding(me);

  return (
    <Screen>
      <AppBar back="/work" title="Your business" />
      <div className="body">
        {ok === "registered"
          ? <div className="banner-ok">You&apos;re registered as a contractor on the same account. Fill this in and add your documents, and work in your trades starts showing up.</div>
          : ok && <div className="banner-ok">Saved.</div>}
        {error && <Notice kind="error">{error}</Notice>}

        <form action={saveBusiness} className="stack" style={{ gap: 12 }}>
          <label className="field">
            <span className="field-label">Business name</span>
            <input className="input" name="name" defaultValue={c?.name ?? ""} placeholder="Ruiz Plumbing &amp; Heating" required />
            <p className="hint">On your own? Your own name is a business name.</p>
          </label>
          <label className="field">
            <span className="field-label">Legal name <span className="text-muted">(if different)</span></span>
            <input className="input" name="legal_name" defaultValue={c?.legal_name ?? ""} placeholder="Ruiz Mechanical LLC" />
          </label>
          <div className="row" style={{ gap: 10 }}>
            <label className="field grow">
              <span className="field-label">Phone</span>
              <input className="input" name="phone" type="tel" inputMode="tel" defaultValue={c?.phone ?? ""} placeholder="(201) 555-0142" />
            </label>
            <label className="field grow">
              <span className="field-label">Email</span>
              <input className="input" name="email" type="email" inputMode="email" defaultValue={c?.email ?? ""} />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Office address <span className="text-muted">(optional)</span></span>
            <input className="input" name="address" defaultValue={c?.address ?? ""} autoComplete="street-address" />
          </label>
          <label className="field">
            <span className="field-label">Website <span className="text-muted">(optional)</span></span>
            <input className="input" name="website" defaultValue={c?.website ?? ""} placeholder="ruizplumbing.com" />
          </label>

          <div className="divider-label">Where you work</div>
          <div className="row" style={{ gap: 10 }}>
            <label className="field grow">
              <span className="field-label">Base ZIP</span>
              <input className="input" name="service_zip" inputMode="numeric" maxLength={5} defaultValue={c?.service_zip ?? ""} placeholder="07666" />
            </label>
            <label className="field grow">
              <span className="field-label">How far you travel</span>
              <span className="input-suffix">
                <input className="input" name="service_radius_miles" inputMode="numeric" defaultValue={c?.service_radius_miles ?? ""} placeholder="15" />
                <span aria-hidden="true">miles</span>
              </span>
            </label>
          </div>
          <label className="check-row">
            <input type="checkbox" name="serves_adjacent_states" value="1" defaultChecked={!!c?.serves_adjacent_states} />
            <span>
              <span className="t">I&apos;ll cross a state line</span>
              <span className="m">Work in New York or Connecticut is fine, not only New Jersey.</span>
            </span>
          </label>
          <p className="tiny text-muted" style={{ margin: 0 }}>We use this to decide which work is worth showing you.</p>

          <div className="divider-label">For the paperwork</div>
          <div className="row" style={{ gap: 10 }}>
            <label className="field grow">
              <span className="field-label">Licence number</span>
              <input className="input" name="license_number" defaultValue={c?.license_number ?? ""} />
            </label>
            <label className="field grow">
              <span className="field-label">EIN <span className="text-muted">(optional)</span></span>
              <input className="input" name="ein" defaultValue={c?.ein ?? ""} placeholder="12-3456789" />
            </label>
          </div>

          <button className="btn btn-primary btn-block">Save</button>
        </form>

        <section className="stack" style={{ gap: 6 }}>
          <div className="divider-label">Also</div>
          <Link href="/business/trades" className="home-row">
            <span className="grow">
              <span className="t">The trades you work</span>
              <span className="m" style={{ display: "block" }}>{me.trades.length > 0 ? me.trades.map((t) => t.trade).join(", ") : "None picked yet"}</span>
            </span>
            <ChevronIcon />
          </Link>
          <Link href="/business/documents" className="home-row">
            <span className="grow">
              <span className="t">Licence, insurance and W-9</span>
              <span className="m" style={{ display: "block" }}>
                {left.filter((o) => ["licence", "gl", "wc", "w9"].includes(o.key)).length === 0
                  ? "All on file" : `${left.filter((o) => ["licence", "gl", "wc", "w9"].includes(o.key)).length} still needed`}
              </span>
            </span>
            <ChevronIcon />
          </Link>
        </section>

        {c?.rating && (
          <Card soft pad>
            <div className="kicker">Your rating</div>
            <div className="small" style={{ marginTop: 4 }}>
              {c.rating.score.toFixed(1)} from {c.rating.responses} {c.rating.responses === 1 ? "job" : "jobs"}
              {c.rating.provisional ? " · still settling in" : ""}
            </div>
          </Card>
        )}

        {/* A contractor brings in the next contractor, or a homeowner they
            already work for. Same form, same function, as the homeowner app. */}
        <InviteForm base="/business" token={token} who={who} kind={kind} />

        {/* Where you land when you sign in, when there is more than one
            door to land in (migration 076). The picker screen is gone;
            this is where the answer lives. */}
        <DefaultDoor held={doors.held} current={doors.default_door} />

        <DoorSwitch held={doors.held} current="expert" />

        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Account</div>
          <Card soft pad>
            <div className="small text-muted" style={{ marginBottom: 10 }}>Signed in as {me.profile.email}.</div>
            <form action={signOut}><button className="btn btn-secondary btn-block">Sign out</button></form>
          </Card>
        </section>
      </div>
    </Screen>
  );
}
