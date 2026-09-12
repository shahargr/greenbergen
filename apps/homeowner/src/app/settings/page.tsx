import Link from "next/link";
import { getMe } from "@/lib/me";
import { signedUrls } from "@/lib/booking";
import { createClient } from "@shared/supabase/server";
import { AppBar, Card, ChevronIcon, DoorSwitch, Notice, Screen } from "@shared/ui";
import { loadDoors } from "@shared/doors.server";
import { DefaultDoor } from "@shared/DefaultDoor";
import { HomePhoto } from "./HomePhoto";
import { InviteForm } from "@shared/invite/InviteForm";
import { inviteToHome, removeHome, saveHome, signOut } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

// Behind the gear: who you are, your homes (editable - this is the one place
// they are managed), the way out, and the way to bring someone else in. Signed out it is the way IN - the same screen,
// so the icon in the header always leads somewhere useful.

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; token?: string; who?: string; kind?: string; invited?: string }> }) {
  const { error, token, who, kind, invited } = await searchParams;
  // Neither depends on the other, so they leave together.
  const [me, doors] = await Promise.all([getMe(), loadDoors()]);

  if (!me.signed_in) {
    return (
      <Screen>
        <AppBar back="/" />
        <div className="body">
          <div className="hero">
            <h1>You&apos;re signed out.</h1>
            <p className="lead">Sign in to see your homes, your jobs and your inbox. Browsing the packages needs no account at all.</p>
          </div>
        </div>
        <div className="actions">
          <Link href="/login" className="btn btn-primary btn-block">Sign in</Link>
          <Link href="/join" className="btn btn-secondary btn-block">Create an account</Link>
          <Link href="/packages" className="btn btn-ghost btn-block">Just browse the packages</Link>
        </div>
      </Screen>
    );
  }

  const name = me.profile.full_name?.trim() || me.profile.email || "Your account";
  // One signed-URL round trip for every home picture on the page.
  const supabase = await createClient();
  const photoUrls = await signedUrls(supabase, me.homes.map((h) => h.photo?.path).filter((p): p is string => !!p));

  return (
    <Screen>
      <AppBar back="/project" title="Your account" />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}
        {invited && <div className="banner-ok">Invitation sent to {invited}. They accept it from their own inbox — nothing changes until they do.</div>}

        <Card pad>
          <div className="card-title">{name}</div>
          <div className="small text-muted">{me.profile.email}{me.profile.home_town ? ` · ${me.profile.home_town}` : ""}{me.profile.home_zip ? ` ${me.profile.home_zip}` : ""}</div>
          <div className="small text-muted" style={{ marginTop: 6 }}>
            {me.homes.length === 0 ? "No home on file yet." : `${me.homes.length} home${me.homes.length === 1 ? "" : "s"} · ${me.bookings.length} job${me.bookings.length === 1 ? "" : "s"}`}
            {me.home_quota?.allowed ? ` · your agreement covers ${me.home_quota.allowed}` : ""}
          </div>
        </Card>

        {/* A home is a ROW now, not a panel. Three homes used to be three
            full cards of open text fields - a screen of form for information
            nobody was editing. The picture does the recognising, the numbers
            say what is happening, and the fields wait behind Edit. */}
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Your homes</div>
          <p className="tiny text-muted" style={{ margin: "-4px 0 2px" }}>
            Tap a home to rename it, add a photo, or bring someone onto it. Another home is offered
            when you book a package and pick where it goes.
          </p>
          {me.homes.length === 0 && <p className="small text-muted" style={{ margin: 0 }}>No home on file yet — the first project you start adds one.</p>}
          {me.homes.map((h) => {
            const busy = [h.live ? `${h.live} in progress` : null, h.planned ? `${h.planned} DIY` : null, h.done ? `${h.done} done` : null]
              .filter(Boolean).join(" · ") || "nothing on it yet";
            const who = h.people.length === 0 ? null
              : h.people.length === 1 ? h.people[0]!.name
              : `${h.people[0]!.name} +${h.people.length - 1}`;
            return (
              <div className="home-panel" key={h.project_id}>
                <div className="home-row">
                  <HomePhoto projectId={h.project_id} url={photoUrls[h.photo?.path ?? ""] ?? null} name={h.name || h.address || "your home"} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t">{h.name || h.address?.split(",")[0] || "Your home"}</span>
                    <span className="m" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {h.address ?? "No address yet"}
                    </span>
                    <span className="m" style={{ display: "block" }}>
                      {busy}{who ? ` · with ${who}` : ""}{h.invited ? ` · ${h.invited} invited` : ""}
                    </span>
                  </span>
                  <Link href={`/project?home=${h.project_id}`} className="btn btn-ghost" style={{ minHeight: 36 }}>Projects</Link>
                </div>

                <details>
                  <summary className="home-row" style={{ paddingTop: 0 }}>
                    <span className="grow small" style={{ color: "var(--muted)" }}>Edit &amp; people</span>
                    <span className="chev"><ChevronIcon /></span>
                  </summary>
                  <div className="drawer stack" style={{ gap: 12, paddingTop: 12 }}>
                    <form action={saveHome.bind(null, h.project_id)} className="stack" style={{ gap: 8 }}>
                      <label className="field">
                        <span className="field-label">Name</span>
                        <input className="input" name="name" defaultValue={h.name ?? ""} placeholder="Home, the rental, Mom's place" />
                      </label>
                      <label className="field">
                        <span className="field-label">Address</span>
                        <input className="input" name="address" defaultValue={h.address ?? ""} autoComplete="street-address" />
                      </label>
                      <button className="btn btn-secondary" style={{ minHeight: 40 }}>Save</button>
                    </form>

                    {/* Who is on the property. A job invitation covers one
                        job; this one covers the house and everything under
                        it, which is what a spouse or a property manager
                        actually needs. */}
                    <div className="stack" style={{ gap: 8 }}>
                      <div className="field-label">Who else is on this home</div>
                      {h.people.length === 0
                        ? <p className="tiny text-muted" style={{ margin: 0 }}>Just you.</p>
                        : <p className="tiny text-muted" style={{ margin: 0 }}>{h.people.map((p) => `${p.name} (${p.role})`).join(" · ")}</p>}
                      <form action={inviteToHome.bind(null, h.project_id)} className="stack" style={{ gap: 8 }}>
                        <label className="field">
                          <span className="field-label">Their email</span>
                          <input className="input" name="email" type="email" inputMode="email" placeholder="them@example.com" />
                        </label>
                        <label className="field">
                          <span className="field-label">or phone</span>
                          <input className="input" name="phone" type="tel" inputMode="tel" placeholder="(201) 555-0100" />
                        </label>
                        <div className="field">
                          <span className="field-label">As</span>
                          <div className="seg" role="radiogroup" aria-label="Their seat on this home">
                            <label className="seg-opt"><input type="radio" name="seat" value="member" /><span>Member</span></label>
                            <label className="seg-opt"><input type="radio" name="seat" value="manager" /><span>Property m.</span></label>
                            <label className="seg-opt"><input type="radio" name="seat" value="contractor" /><span>Contractor</span></label>
                            <label className="seg-opt"><input type="radio" name="seat" value="viewer" defaultChecked /><span>Viewer</span></label>
                          </div>
                          <p className="hint">
                            A member does everything you do, money included. A property manager runs the work and
                            gets the job board. A contractor works from the pro seat. A viewer sees the home, never the money.
                          </p>
                        </div>
                        <label className="field">
                          <span className="field-label">A note <span className="text-muted">(optional)</span></span>
                          <input className="input" name="note" placeholder="Mom, this is the house." />
                        </label>
                        <button className="btn btn-secondary" style={{ minHeight: 40 }}>Send the invitation</button>
                        <p className="tiny text-muted" style={{ margin: 0 }}>
                          They need a Green Bergen account already — invite a newcomer below first. Nothing changes until they accept.
                        </p>
                      </form>
                    </div>

                    {/* Removal is its own form so a stray Enter in the name
                        field can never trash a home. It refuses while jobs
                        are live. */}
                    {h.live === 0 && (
                      <form action={removeHome.bind(null, h.project_id)}>
                        <button className="btn btn-ghost btn-danger" style={{ minHeight: 36, padding: 0 }}>Take this home off my account</button>
                      </form>
                    )}
                  </div>
                </details>
              </div>
            );
          })}
          <Link href="/homes/new" className="home-row add">
            <span className="ic">+</span>
            <span className="grow"><span className="t">Add another home</span></span>
            <ChevronIcon />
          </Link>
        </section>

        {/* Bringing someone in: the one invitation form every door shows.
            invite_peer decides the kind and the quota; every field is
            optional; the link comes back here to copy or share. */}
        <InviteForm base="/settings" token={token} who={who} kind={kind} />

        {/* Where you land when you sign in, when there is more than one
            door to land in (migration 076). The picker screen is gone;
            this is where the answer lives. */}
        <DefaultDoor held={doors.held} current={doors.default_door} />

        <DoorSwitch held={doors.held} current="homeowner" />

        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Account</div>
          <Card soft pad>
            <div className="small text-muted" style={{ marginBottom: 10 }}>Signed in as {me.profile.email}. Signing out keeps everything — your homes, jobs and messages are on your account, not this phone.</div>
            <form action={signOut}><button className="btn btn-secondary btn-block">Sign out</button></form>
          </Card>
        </section>
      </div>
    </Screen>
  );
}
