import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/me";
import { AppBar, Card, Notice, Screen, ShellIcons } from "@shared/ui";
import { unreadForShell } from "@shared/unread";
import { BookingRow, ORDER, ProjectRow, SECTION, TABS, bucketOf, rowsFor, type Bucket } from "@/components/ProjectRows";
import { stopwatch } from "@shared/perf";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your projects" };

// THE FILING CABINET, ON ITS OWN SCREEN (Shahar, 2026-09-19): "These and the
// list of projects can be removed from the home page. If user has existing
// project allow him to know this and click to see them and manage them."
//
// The list did not go away - it moved. A home screen answers "what now"; this
// answers "where is everything", and they are different questions asked at
// different moments. Off the home screen the list can also be FULLER than it
// was: the tabs come back and Done keeps its section under All, because on a
// screen you opened on purpose a finished job is something you might be
// looking for rather than something in your way.
//
// Plural, beside /packages, which is the same shape: the list is /projects
// and one of them is /project/[id].
export default async function ProjectsIndex({ searchParams }: { searchParams: Promise<{ show?: string; home?: string }> }) {
  const { show, home } = await searchParams;
  const w = stopwatch("/projects");
  const me = await w.step("me", () => getMe());
  w.done();
  if (!me.signed_in) redirect("/login?next=/projects");
  const unread = await unreadForShell();

  const { onlyHome, mine, counts, manyHomes } = rowsFor(me, home);

  // Nobody asked, so: what is on-going - unless nothing is, in which case the
  // first tab with something on it, and "All" if none of them do.
  const asked: Bucket | "all" | null =
    show === "all" || ORDER.some((k) => k === show) ? (show as Bucket | "all") : null;
  const filter: Bucket | "all" =
    asked ?? (counts.going > 0 ? "going" : ORDER.find((k) => counts[k] > 0) ?? "all");
  const shown = mine.filter((r) => filter === "all" || bucketOf(r) === filter);
  const href = (b: Bucket | "all") => {
    const q = new URLSearchParams();
    if (onlyHome) q.set("home", onlyHome.project_id);
    if (b !== "going") q.set("show", b);
    return q.size ? `/projects?${q}` : "/projects";
  };

  return (
    <Screen>
      <AppBar
        back="/project"
        title="Your projects"
        right={<ShellIcons unread={unread} />}
      />
      <div className="body">
        {me.missing && <Notice title="Preview mode">The database migration in db/ has not been applied yet, so homes and projects cannot be read.</Notice>}
        {me.degraded && <Notice kind="error" title="We couldn&apos;t load your homes just now.">Nothing is lost. <Link href="/projects">Try again</Link>, and if it keeps happening tell us.</Notice>}

        {counts.all === 0 ? (
          <Card soft pad>
            <div className="card-title">Nothing here yet</div>
            <p className="small text-muted" style={{ margin: "4px 0 10px" }}>
              Your home is added the first time a project needs it.
            </p>
            <Link href="/packages" className="btn btn-primary btn-block">Browse packages</Link>
          </Card>
        ) : (
          <>
            {onlyHome && (
              <>
                <div className="divider-label">{onlyHome.address?.split(",")[0] ?? "This home"}</div>
                <Link href="/projects" className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: 0 }}>← All homes</Link>
              </>
            )}

            <nav className="chips" aria-label="Filter projects">
              {TABS.filter((x) => x.key === "all" || counts[x.key] > 0).map((x) => (
                <Link key={x.key} href={href(x.key)} className={`tag ${filter === x.key ? "" : "tag-neutral"}`} aria-current={filter === x.key ? "page" : undefined} style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }}>
                  {x.label} · {counts[x.key]}
                </Link>
              ))}
            </nav>

            {(filter === "all" ? ORDER : [filter]).map((k) => {
              const rows = shown.filter((r) => bucketOf(r) === k);
              if (rows.length === 0) return null;
              return (
                <section className="stack" style={{ gap: 10 }} key={k}>
                  {filter === "all" && <div className="divider-label">{SECTION[k]}</div>}
                  {/* A booking row draws from the booking, but which way the
                      job was taken lives on the project half of the same row. */}
                  {rows.map((r) => r.kind === "booking"
                    ? <BookingRow key={r.project_id} b={r.b} showHome={manyHomes && !onlyHome} delivery={r.p.delivery} />
                    : <ProjectRow key={r.project_id} p={r.p} showHome={manyHomes && !onlyHome} />)}
                </section>
              );
            })}
          </>
        )}
      </div>
    </Screen>
  );
}
