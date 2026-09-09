import Link from "next/link";

// ONE tab bar for the Home experts app.
//
// It was two - ExpertTabs (work / jobs / inbox) in the contractor app and
// ExpertTabs (board / tasks / money / inbox) in the builder app - because
// they were two apps for what turned out to be one person. Project
// management is a trade, not an identity (migration 030), so the tabs are
// one bar whose middle grows when you actually run work.
//
// `manages` is my_doors().manages: a project seat at authority_rank >= 50.
// Someone who only holds trades never sees Projects, Tasks or Money, so the
// bar stays three wide for most people and does not advertise a surface
// they have nothing to put in.
export function ExpertTabs({ current, manages = false, offers = 0, tasks = 0 }: {
  current: "work" | "jobs" | "projects" | "tasks" | "money" | "inbox";
  manages?: boolean; offers?: number; tasks?: number;
}) {
  return (
    <nav className="tabs" aria-label="Sections">
      <Link href="/work" aria-current={current === "work" ? "page" : undefined}>
        Work{offers > 0 && <span className="n">{offers}</span>}
      </Link>
      <Link href="/jobs" aria-current={current === "jobs" ? "page" : undefined}>My jobs</Link>
      {manages && (
        <>
          <Link href="/projects" aria-current={current === "projects" ? "page" : undefined}>Projects</Link>
          <Link href="/tasks" aria-current={current === "tasks" ? "page" : undefined}>
            Tasks{tasks > 0 && <span className="n">{tasks}</span>}
          </Link>
        </>
      )}
      <Link href="/inbox" aria-current={current === "inbox" ? "page" : undefined}>Inbox</Link>
    </nav>
  );
}
