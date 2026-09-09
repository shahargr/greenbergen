import Link from "next/link";
import { getMe } from "@/lib/me";
import { AppBar, Card, ChevronIcon, DoorSwitch, Notice, Screen } from "@shared/ui";
import { loadDoors } from "@shared/doors.server";
import { CopyLink } from "../project/[id]/people/CopyLink";
import { invitePerson, removeHome, saveHome, signOut } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

// Behind the gear: who you are, your homes (editable - this is the one place
// they are managed), the way out, and the way to bring someone else in. Signed out it is the way IN - the same screen,
// so the icon in the header always leads somewhere useful.
const PORTAL = process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://greenbergen.vercel.app";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; token?: string; who?: string; kind?: string }> }) {
  const { error, token, who, kind } = await searchParams;
  // Neither depends on the other, so they leave together.
  const [me, doors] = await Promise.all([getMe(), loadDoors()]);
  const link = token ? `${PORTAL}/join?invite=${encodeURIComponent(token)}` : null;

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

  return (
    <Screen>
      <AppBar back="/project" title="Your account" />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}

        <Card pad>
          <div className="card-title">{name}</div>
          <div className="small text-muted">{me.profile.email}{me.profile.home_town ? ` · ${me.profile.home_town}` : ""}{me.profile.home_zip ? ` ${me.profile.home_zip}` : ""}</div>
          <div className="small text-muted" style={{ marginTop: 6 }}>
            {me.homes.length === 0 ? "No home on file yet." : `${me.homes.length} home${me.homes.length === 1 ? "" : "s"} · ${me.bookings.length} job${me.bookings.length === 1 ? "" : "s"}`}
            {me.home_quota?.allowed ? ` · your agreement covers ${me.home_quota.allowed}` : ""}
          </div>
        </Card>

        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Your homes</div>
          <p className="tiny text-muted" style={{ margin: "-4px 0 2px" }}>
            Where your projects live. Rename one, fix an address, or take one off. Another home is
            offered when you book a package and pick where it goes.
          </p>
          {me.homes.length === 0 && <p className="small text-muted" style={{ margin: 0 }}>No home on file yet — the first project you start adds one.</p>}
          {me.homes.map((h) => (
            <Card key={h.project_id} pad>
              <form action={saveHome.bind(null, h.project_id)} className="stack" style={{ gap: 8 }}>
                <label className="field">
                  <span className="field-label">Name</span>
                  <input className="input" name="name" defaultValue={h.name ?? ""} placeholder="Home, the rental, Mom's place" />
                </label>
                <label className="field">
                  <span className="field-label">Address</span>
                  <input className="input" name="address" defaultValue={h.address ?? ""} autoComplete="street-address" />
                </label>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="tiny text-muted">{[h.live ? `${h.live} in progress` : null, h.planned ? `${h.planned} DIY` : null, h.done ? `${h.done} done` : null].filter(Boolean).join(" · ") || "nothing on it yet"}</span>
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn btn-secondary" style={{ minHeight: 40 }}>Save</button>
                    <Link href={`/project?home=${h.project_id}`} className="btn btn-ghost" style={{ minHeight: 40 }}>Projects</Link>
                  </span>
                </div>
              </form>
              {/* Removal is its own form so a stray Enter in the name field
                  can never trash a home. It refuses while jobs are live. */}
              {h.live === 0 && (
                <form action={removeHome.bind(null, h.project_id)} style={{ marginTop: 4 }}>
                  <button className="btn btn-ghost btn-danger" style={{ minHeight: 36, padding: 0 }}>Take this home off my account</button>
                </form>
              )}
            </Card>
          ))}
          <Link href="/homes/new" className="home-row add">
            <span className="ic">+</span>
            <span className="grow"><span className="t">Add another home</span></span>
            <ChevronIcon />
          </Link>
        </section>

        {/* Bringing someone in. Same machinery the portal uses for its own
            invitations - a link they redeem on the join page. */}
        <section className="stack" style={{ gap: 10 }}>
          <div className="divider-label">Invite someone to Green Bergen</div>
          {link ? (
            <Card pad>
              <div className="card-title" style={{ fontSize: 15 }}>A link for {who ?? "them"}</div>
              <p className="small text-muted" style={{ margin: "2px 0 10px" }}>
                Send it however you like — text, email, in person. It brings them in as {kind === "contractor" ? "a contractor" : "a neighbor with their own home"}. Nobody joins until they open it.
              </p>
              <CopyLink link={link} />
              <p className="tiny text-muted" style={{ marginTop: 10 }}><Link href="/settings">Make another</Link></p>
            </Card>
          ) : (
            <Card pad>
              <form action={invitePerson} className="stack" style={{ gap: 10 }}>
                <label className="field">
                  <span className="field-label">Who is it?</span>
                  <select className="input" name="kind" defaultValue="homeowner">
                    <option value="homeowner">A neighbor — their own home, their own jobs</option>
                    <option value="contractor">A contractor — they take jobs at the community price</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Their name <span className="text-muted">(optional)</span></span>
                  <input className="input" name="name" placeholder="Dana from two doors down" />
                </label>
                <label className="field">
                  <span className="field-label">Their email <span className="text-muted">(optional)</span></span>
                  <input className="input" name="email" type="email" inputMode="email" placeholder="dana@example.com" />
                  <p className="hint">Leave it blank and you just get a link to pass on yourself.</p>
                </label>
                <label className="field">
                  <span className="field-label">A line from you <span className="text-muted">(optional)</span></span>
                  <textarea className="input" name="note" rows={2} placeholder="This is the group we used for the water heater." />
                </label>
                <button className="btn btn-primary btn-block">Make the invitation</button>
              </form>
            </Card>
          )}
        </section>

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
