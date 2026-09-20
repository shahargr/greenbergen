import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { setView, beginViewAs, endViewAs } from "@/components/viewas";
import { VIEW_HOME } from "@/components/viewmap";
import { DOOR_ENTRY, DOOR_LABEL, DOOR_ORDER, type DoorKey } from "@/lib/doors";
import { loadDoors } from "@/lib/doors.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Console · Admin" };

// THE CONSOLE - the gear, as a screen (Shahar, 2026-09-18).
//
// Three things used to be scattered: the Admin console link was buried in
// /my/settings behind the gear ("we need the Admin console on the Admin bar
// instead of find it under the gear icon"), the acting-as mask was a dropdown
// in the top bar, and the door switch was another icon beside it. They are
// the same kind of thing - the knobs on WHO and WHAT you are while you are
// here - and none of them belongs in a row of icons you use every minute.
//
// So the gear is a button now, it opens this, and this holds them: every
// project on the platform, whose eyes you are looking through, and which door
// you leave by. Nothing here is a daily control; all of it is the kind you
// want stated in full sentences before you touch it.
const HERE = "/admin/console";

// Every hat a view can be designed for. The ones without a surface yet are
// listed but not selectable - the same list the top-bar mask carried.
const ALL_VIEWS = ["Owner", "Contractor", "PM", "GC", "Buyer", "Developer", "Viewer", "Admin"] as const;

export default async function AdminConsolePage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: me }, { data: borrowed }, { data: canActData }, doors, jar] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("borrowed_seat"),
    supabase.rpc("borrowed_can_act"),
    loadDoors(),
    cookies(),
  ]);

  const canAct = canActData === true;
  const picked = jar.get("gb_view")?.value ?? "Admin";

  const otherDoors = DOOR_ORDER.filter((k: DoorKey) => k !== "admin" && doors.held.includes(k));

  return (
    <main>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Console</h1>
      <p className="muted small" style={{ margin: "0 0 14px" }}>
        You are signed in as <strong>{me?.full_name ?? me?.email}</strong> with administrator rights.
        What you can reach is already decided by the database — these change what you are SHOWN, whose eyes
        you look through, and which door you leave by.
      </p>

      {error && <p className="card" style={{ borderLeft: "4px solid var(--danger)" }}>{error}</p>}


      {/* 2. THE MASK. Two different things wearing one name: which SURFACE
          you are looking at, and whose ACCOUNT you are looking through. */}
      <div className="card" id="acting">
        <h2 className="section-title">Acting as</h2>

        {borrowed ? (
          <p className="small" style={{ marginTop: 0, padding: "8px 10px", borderRadius: 8, background: canAct ? "#fbeaec" : "#fdf1e3" }}>
            {canAct
              ? <>⚡ You are <strong>acting as {me?.full_name ?? me?.email}</strong>. Every change lands as them,
                  logged with your name behind it. It expires in an hour.</>
              : <>👁 You are <strong>viewing as {me?.full_name ?? me?.email}</strong> — their eyes only. Changes are
                  refused. It expires in an hour.</>}
          </p>
        ) : (
          <p className="muted small" style={{ marginTop: 0 }}>
            You are yourself. <strong>View</strong> shows you the system through somebody&rsquo;s eyes and refuses every
            change; <strong>act</strong> does things as them and writes your name into the log behind it.
          </p>
        )}

        {borrowed && (
          <div className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
            {!canAct && (
              <form action={beginViewAs.bind(null, String(borrowed), true, HERE)}>
                <button className="btn small" style={{ background: "#7a1f2b" }}>⚡ Act as them</button>
              </form>
            )}
            <form action={endViewAs.bind(null, HERE)}>
              <button className="btn ghost small">↩ Return to myself</button>
            </form>
          </div>
        )}

        <h6 style={{ margin: "14px 0 4px" }}>Which surface</h6>
        <p className="muted tiny" style={{ margin: "0 0 8px" }}>
          The hat the screens are designed for. Picking one takes you to its home.
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ALL_VIEWS.map((v) =>
            v === picked ? (
              <span key={v} className="chip">{v} ✓</span>
            ) : VIEW_HOME[v] ? (
              <form key={v} action={setView.bind(null, v)}>
                <button className="btn ghost small">{v}</button>
              </form>
            ) : (
              <span key={v} className="chip" style={{ opacity: 0.55 }}>{v} · soon</span>
            ),
          )}
        </div>

      </div>

      {/* 3. THE DOOR. One login, three doors; this is how you cross. */}
      <div className="card" id="doors">
        <h2 className="section-title">Switch door</h2>
        {otherDoors.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>Admin is the only door on your account.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {otherDoors.map((k) => (
              <a key={k} href={DOOR_ENTRY[k]} className="door-mask-row" style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
                <strong>{DOOR_LABEL[k].title}</strong>
                <span>{DOOR_LABEL[k].blurb}</span>
              </a>
            ))}
            <p className="muted tiny" style={{ margin: 0 }}>
              Where you land when you sign in is set in <Link href="/my/settings">your settings</Link>.
            </p>
          </div>
        )}
      </div>

      {/* 4. THE REST OF THE PLATFORM, in one place - so nothing that came off
          the sidebar became hard to find. */}
      <div className="card">
        <h2 className="section-title">Everything else</h2>
        <div className="admin-index">
          <Link href="/admin"><strong>Overview</strong><span>The dashboard, the banner, the seasonal tips</span></Link>
          <Link href="/admin/photos"><strong>Public pages</strong><span>Landing photographs and the public tagline</span></Link>
          <Link href="/admin/stats"><strong>Usage</strong><span>Who is here and what they are doing</span></Link>
          <Link href="/admin/deals"><strong>Deals</strong><span>Contracts, bids and what they are worth</span></Link>
          <Link href="/admin/storage"><strong>Storage</strong><span>Media objects, the database, per-person quota</span></Link>
          <Link href="/admin/finance"><strong>Finance</strong><span>Money in, money out, the ledger</span></Link>
          <Link href="/admin/users"><strong>Users &amp; contractors</strong><span>Everyone on the platform — and viewing or acting as them</span></Link>
          <Link href="/my/projects"><strong>Projects</strong><span>Every project, and the switch between yours and the platform&rsquo;s</span></Link>
          <Link href="/my/settings"><strong>Your account</strong><span>Your own profile, notifications and default door</span></Link>
        </div>
      </div>
    </main>
  );
}
