import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administration · Admin" };

// THE ADMINISTRATION LANDING.
//
// Shahar, 2026-09-20: "admin page should focus only on administration and not
// visibility into projects. re-design the admin page to reflects this
// concept. imagine an admin arrive to the site."
//
// What was here: six tiles, then a mile of forms - the tagline, three photo
// pickers, the welcome video, the recycle bin, the banner, twelve months of
// tips. Editing the site is not the same job as administering it, so all of
// that moved to /admin/site and this became what an administrator actually
// opens the door for: the shape of the platform, and the way in to each part
// of it.
//
// PROJECTS ARE DELIBERATELY NOT HERE. An administrator who wants to look at a
// job goes to the job; the console's business is the catalogue, the people,
// the towns and the machine. The one link at the foot says where the projects
// went, because removing something without saying where it is is just hiding
// it.
//
// EVERY NUMBER IS COUNTED, NEVER ESTIMATED, and comes from one call to
// admin_console() (migration 200) rather than a dozen counts fired from here.
// Where the honest answer is zero it says zero, and the zeroes are the point:
// nothing has been bought through the app yet, three towns of sixty-six have
// their documents, one package of twenty-one has a DIY checklist. A console
// that rounded those up would be worse than no console.

type Console = Partial<Record<
  | "users_active" | "users_all" | "invites_pending" | "contacts" | "companies"
  | "projects_live"
  | "bookings_all" | "purchases" | "purchases_cents"
  | "settlements" | "payment_stages" | "contracts"
  | "proposals" | "proposals_won" | "bid_packages"
  | "packages_active" | "packages_all" | "packages_with_checklist"
  | "trades" | "trades_worker" | "catalogue_items"
  | "towns" | "towns_documented" | "promotions"
  | "files" | "trigger_errors",
  number>>;

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    .format(cents / 100);

// A tile is either LIVE - it goes somewhere that exists - or it is honest
// about not being built. Nothing in between: a tile that looks live and lands
// on an empty screen costs more trust than a tile that says "not yet".
type Tile = {
  title: string;
  note: string;
  href?: string;          // absent = nothing to open yet
  value?: string;         // the count, when there is a real one
  warn?: boolean;         // the number is the problem, not the achievement
};
type Section = { title: string; lead: string; tiles: Tile[] };

export default async function AdminHome() {
  const supabase = await createClient();
  // The layout already refuses anyone who is not a superadmin; admin_console()
  // refuses again in the database, so a missing guard here cannot leak a count.
  const { data } = await supabase.rpc("admin_console");
  const c: Console = (data ?? {}) as Console;
  const n = (k: keyof Console) => c[k] ?? 0;

  const headline = [
    { label: "Members", big: String(n("users_active")),
      note: `${n("invites_pending")} invited, not joined`, href: "/admin/users" },
    { label: "Projects", big: String(n("projects_live")),
      note: "live on the platform", href: "/admin/projects" },
    { label: "Purchases", big: String(n("purchases")),
      note: n("purchases") > 0 ? money(n("purchases_cents")) : `nothing bought yet · ${n("bookings_all")} planned`,
      href: "/admin/finance" },
    { label: "Proposals", big: String(n("proposals")),
      note: `${n("proposals_won")} won · ${n("bid_packages")} bid packages`, href: "/admin/deals" },
  ];

  const sections: Section[] = [
    {
      title: "The catalogue",
      lead: "What can be bought, and what somebody is told to do once they buy it.",
      tiles: [
        { title: "Packages", note: "Scope, levers, prices, photos, the progress line.",
          value: `${n("packages_active")} live of ${n("packages_all")}`, href: "/admin/packages" },
        { title: "DIY checklists", note: "The real steps for a job somebody takes on themselves.",
          value: `${n("packages_with_checklist")} of ${n("packages_all")} packages`,
          warn: n("packages_with_checklist") < n("packages_all"), href: "/admin/activities" },
        { title: "Trades", note: "Every trade, which of them do work, what each must document.",
          value: `${n("trades")} · ${n("trades_worker")} worker trades` },
        { title: "Item catalogue", note: "The line items packages and scopes are assembled from.",
          value: String(n("catalogue_items")) },
      ],
    },
    {
      title: "People",
      lead: "Who is on the platform, and who is allowed to take work.",
      tiles: [
        { title: "Users", note: "Accounts by type, seats, activation, trades held.",
          value: `${n("users_active")} active of ${n("users_all")}`, href: "/admin/users" },
        { title: "Invitations", note: "Sent, opened, still waiting to be redeemed.",
          value: `${n("invites_pending")} pending`, href: "/my/invite" },
        { title: "Directory", note: "Contacts and companies behind the accounts.",
          value: `${n("contacts")} contacts · ${n("companies")} companies` },
        { title: "Vetting", note: "Licences, insurance certificates, approvals — what gates a first job." },
      ],
    },
    {
      title: "Where we work",
      lead: "The service area, and what is true about each town in it.",
      tiles: [
        { title: "Town documents", note: "Permits, recycling, schedules — what differs street to street.",
          value: `${n("towns_documented")} of ${n("towns")} towns`,
          warn: n("towns_documented") < n("towns") },
        { title: "Service area", note: "The ZIP codes and towns the apps will serve at all.",
          value: `${n("towns")} towns` },
        { title: "Promotions", note: "Group deals: a town, a trade, a window, a minimum.",
          value: String(n("promotions")) },
      ],
    },
    {
      title: "The site",
      lead: "What a stranger reads before they have asked anything.",
      tiles: [
        { title: "Site design", note: "Tagline, landing photo, Bob's photo, welcome video, banner, monthly tips.",
          href: "/admin/site" },
        { title: "Public pages", note: "Hero photos, galleries, about text, scope facts.", href: "/admin/photos" },
        { title: "Help content", note: "The answers the apps link to when somebody is stuck." },
      ],
    },
    {
      title: "Money",
      lead: "What was agreed, what was collected, what the platform earned.",
      tiles: [
        { title: "Purchases", note: "Bookings that somebody accepted, and what they were worth.",
          value: n("purchases") > 0 ? `${n("purchases")} · ${money(n("purchases_cents"))}` : "none yet" },
        { title: "Settlements", note: "Money that actually moved, milestone by milestone.",
          value: `${n("settlements")} of ${n("payment_stages")} stages`, warn: n("settlements") === 0 },
        { title: "Contracts", note: "Agreements on file, and the terms they carry.",
          value: String(n("contracts")) },
        { title: "Finance", note: "Agreements, billing, receivables.", href: "/admin/finance" },
      ],
    },
    {
      title: "The machine",
      lead: "Whether the thing is working, and who has been inside it.",
      tiles: [
        { title: "Usage", note: "Who signs in, what they do, tasks made and closed, day by day.",
          href: "/admin/stats" },
        { title: "Storage", note: "Every file the platform holds and what points at it.",
          value: `${n("files")} files`, href: "/admin/storage" },
        { title: "System errors", note: "Triggers that failed where nobody was looking.",
          value: String(n("trigger_errors")), warn: n("trigger_errors") > 0 },
        { title: "Console", note: "God mode, acting as somebody else, which door you leave by.",
          href: "/admin/console" },
      ],
    },
    {
      title: "Working with Claude",
      lead: "What an agent may do here without stopping to ask.",
      tiles: [
        { title: "Supabase permissions", note: "The allow list, and the settings file that actually carries it.",
          href: "/admin/claude" },
      ],
    },
  ];

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96 }}>
      <span className="kicker">Admin</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Administration</h1>
      <p className="muted small" style={{ margin: "0 0 18px", maxWidth: 640 }}>
        The shape of the platform, and the way in to every part of it.
      </p>

      <div className="admin-tiles" style={{ marginBottom: 26 }}>
        {headline.map((h) => (
          <Link key={h.label} href={h.href} className="card stat statlink">
            <span className="stat-kicker">{h.label}</span>
            <span className="stat-big">{h.big}</span>
            <span className="muted small">{h.note}</span>
          </Link>
        ))}
      </div>

      {sections.map((s) => (
        <section key={s.title} style={{ marginBottom: 26 }}>
          <h2 className="section-title" style={{ marginBottom: 2 }}>{s.title}</h2>
          <p className="muted small" style={{ margin: "0 0 10px" }}>{s.lead}</p>
          <div className="admin-tiles">
            {s.tiles.map((t) => {
              const body = (
                <>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <strong>{t.title}</strong>
                    {t.value && (
                      <span className="small" style={{ whiteSpace: "nowrap", fontWeight: 700,
                        color: t.warn ? "var(--brand)" : undefined }}>{t.value}</span>
                    )}
                  </span>
                  <span className="muted small">{t.note}</span>
                  {!t.href && <span className="small" style={{ color: "var(--muted)" }}>No screen yet</span>}
                </>
              );
              return t.href
                ? <Link key={t.title} href={t.href} className="card statlink admin-tile">{body}</Link>
                : <div key={t.title} className="card admin-tile" style={{ opacity: 0.72 }}>{body}</div>;
            })}
          </div>
        </section>
      ))}

      {/* Said out loud rather than left as an absence: the projects did not
          disappear, they were never this screen's job. */}
      <p className="muted small" style={{ maxWidth: 640 }}>
        Looking for a particular job? Projects are not administered from here —
        the whole list is under <Link href="/admin/projects">all projects</Link>,
        and the ones you hold a seat on are on <Link href="/my">your own dashboard</Link>.
      </p>
    </main>
  );
}
