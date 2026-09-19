import Link from "next/link";
import { targetWindowLabel, type BookingSummary, type Me, type ProjectSummary } from "@/lib/me";
import { dollars, shortDate } from "@shared/format";
import { Illustration } from "@shared/Illustrations";

// THE PROJECT LIST, ONCE, FOR THE TWO SCREENS THAT SHOW IT.
//
// The home screen says only HOW MANY and links onward (Shahar, 2026-09-19:
// "These and the list of projects can be removed from the home page. If user
// has existing project allow him to know this and click to see them and
// manage them"); /projects is the list itself. Both read the same buckets and
// draw the same rows from here rather than each keeping a copy - a second
// copy of bucketOf is how two screens start disagreeing about what "on-going"
// means.

export type Bucket = "offers" | "going" | "done";

// TWO GROUPS, AND THE SPLIT IS WHO YOU ARE WAITING FOR. Shahar (2026-09-15):
// "Change under way to on-going (DIY or Awarded) / Change lining up to
// pending offers / Remove done, keeping all."
//
//   Pending offers          somebody has been ASKED and has not answered.
//   On-going (DIY or        nobody is being waited on: either a contractor
//   Awarded)                has it, or you do.
//
// Done has a heading without having a tab, which is the whole point of
// keeping it under All.
export const OPEN: Bucket[] = ["going", "offers"];
export const ORDER: Bucket[] = ["going", "offers", "done"];
export const SECTION: Record<Bucket, string> = {
  going: "On-going (DIY or Awarded)",
  offers: "Pending offers",
  done: "Done",
};
export const TABS: { key: Bucket | "all"; label: string }[] = [
  { key: "going", label: "On-going (DIY or Awarded)" },
  { key: "offers", label: "Pending offers" },
  { key: "all", label: "All" },
];

// ONE ROW PER JOB, booked or not (migration 116). Shahar, with two
// screenshots: "as professional i see both Ran and My own generator project.
// as home owner, i see none." It listed BOOKINGS, and six of his ten jobs
// never came through the booking wizard.
export type Row =
  | { kind: "booking"; project_id: string; b: BookingSummary; p: ProjectSummary }
  | { kind: "project"; project_id: string; p: ProjectSummary };

// WHERE IT STANDS, decided once in the database and only read here. Shahar
// (2026-09-14): "tells me the generator is in progress while in fact it
// isn't." It was: this bucketed by projects.status, the value a project is
// BORN with. project_progress reads the stage AND checks it against the
// record - people, contracts, money, bids, finished work.
export const bucketOf = (r: Row): Bucket | "cancelled" => {
  const k = r.p.progress_label?.key;
  if (k === "cancelled") return "cancelled";
  if (k === "done") return "done";
  // bid / finding / compare - somebody has been asked and has not answered.
  // Everything else is running or sitting on your own list, and both of those
  // are on-going: nobody owes you an answer.
  return k === "bid" || k === "finding" || k === "compare" ? "offers" : "going";
};

// Semantic colour, not decoration: finished is good, somebody working is
// live, waiting on you is a flag, and everything else is quiet.
export const tagFor = (key?: string) =>
  key === "done" ? "tag tag-ok"
  : key === "active" ? "tag tag-status"
  : key === "delivered" || key === "verification" ? "tag tag-status"
  : key === "cancelled" ? "tag tag-neutral"
  : "tag tag-outline";

export type MeIn = Extract<Me, { signed_in: true }>;

// The projects are the spine: every job under a home the member owns. A
// booking, where there is one, is what dresses the row. Cancelled never
// reaches either screen (Shahar, 2026-09-12: "a pointing finger to negative
// experience likely - should not be here").
export function rowsFor(me: MeIn, home?: string) {
  const onlyHome = me.homes.find((h) => h.project_id === home) ?? null;
  const booked = new Map(me.bookings.map((b) => [b.project_id, b]));
  const all: Row[] = me.projects.map((p) => {
    const b = booked.get(p.project_id);
    return b ? { kind: "booking" as const, project_id: p.project_id, b, p } : { kind: "project" as const, project_id: p.project_id, p };
  });
  const mine = (onlyHome ? all.filter((r) => r.p.home_project_id === onlyHome.project_id) : all)
    .filter((r) => bucketOf(r) !== "cancelled");
  const counts = { all: mine.length, going: 0, offers: 0, done: 0 } as Record<Bucket | "all", number>;
  for (const r of mine) counts[bucketOf(r) as Bucket]++;
  return { onlyHome, mine, counts, manyHomes: me.homes.length > 1 };
}


// A JOB NOBODY BOOKED. No package, no price, no wizard answers - a name,
// what is open on it, and the way in. Everything the booking row shows comes
// from a booking, and inventing any of it here would be a lie with a number
// in it.
export function ProjectRow({ p, showHome }: { p: ProjectSummary; showHome: boolean }) {
  const st = p.progress_label;
  return (
    <Link href={`/project/${p.project_id}`} className="home-row">
      <span className="ic" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-5h4v5" />
        </svg>
      </span>
      <span className="grow">
        <span className="t">{p.name}{p.unread > 0 && <span className="tag tag-status" style={{ marginLeft: 6, padding: "1px 7px" }}>{p.unread}</span>}</span>
        <span className="m" style={{ display: "block" }}>
          {[showHome && p.home_name ? p.home_name : null, st?.detail].filter(Boolean).join(" · ")}
        </span>
      </span>
      {st && <span className={tagFor(st.key)}>{st.label}</span>}
    </Link>
  );
}

export function BookingRow({ b, showHome }: { b: BookingSummary; showHome: boolean }) {
  // The same rule as every other row (migration 119). What a booking adds is
  // the money: a reference price while it is a plan, what it went out at
  // while it is looking, what it came to when it is finished.
  const st = b.progress_label;
  const money =
    st?.key === "planned" ? `${dollars(b.price_cents)} reference${b.config_label ? ` · ${b.config_label}` : ""}`
    : st?.key === "finding" ? `${dollars(b.price_cents)} · posted ${shortDate(b.posted_at)}`
    : st?.key === "done" && b.price_cents > 0 ? `${dollars(b.price_cents)} · ${shortDate(b.done_at)}`
    : null;
  const line = [
    showHome && b.address ? b.address.split(",")[0] : null,
    b.contractor?.name ?? null,
    money ?? st?.detail ?? null,
  ].filter(Boolean).join(" · ");
  return (
    <Link href={`/project/${b.project_id}`} className="home-row">
      <span className="ic"><Illustration name={b.illustration} /></span>
      <span className="grow">
        <span className="t">{b.name}{b.unread > 0 && <span className="tag tag-status" style={{ marginLeft: 6, padding: "1px 7px" }}>{b.unread}</span>}</span>
        <span className="m" style={{ display: "block" }}>{line}</span>
      </span>
      {st
        ? <span className={tagFor(st.key)}>{st.key === "planned" ? targetWindowLabel(b.target_window) : st.label}</span>
        : null}
    </Link>
  );
}
