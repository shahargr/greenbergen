import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBar, Card, ChevronIcon, Screen } from "@shared/ui";
import { getBoard, money, runs } from "@/lib/board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money" };

// Money, across every project you hold a seat on: one row each, what you
// are owed on it, and the way in to that project's money page - where the
// milestones, changes and the ledger live.
export default async function MoneyPage() {
  const b = await getBoard();
  if (!b.signed_in) redirect("/login?next=/money");
  const seats = [...b.seats]
    .filter((s) => !s.parent_project_id || !b.seats.some((p) => p.project_id === s.parent_project_id))
    .sort((x, y) => y.owed - x.owed || x.project_name.localeCompare(y.project_name));
  const owed = b.seats.reduce((a, s) => a + (s.owed ?? 0), 0);

  return (
    <Screen>
      <AppBar back="/work" title="Money" />
      <div className="body">
        <div className="hero">
          <h1>Money</h1>
          <p className="lead">{owed > 0 ? `${money(owed)} owed to you across ${b.seats.filter((s) => s.owed > 0).length} ${b.seats.filter((s) => s.owed > 0).length === 1 ? "job" : "jobs"}.` : "Milestones, changes and what each job owes, per project."}</p>
        </div>
        {seats.length === 0 && (
          <Card soft pad><div className="small">No projects yet. Money appears here per job once you hold one.</div></Card>
        )}
        {seats.map((s) => (
          <Link href={`/project/${s.project_id}/money`} className="home-row" key={s.project_id}>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{s.project_name}</span>
              <span className="m" style={{ display: "block" }}>
                {[runs(s) ? "you run it" : s.seat, s.address ?? s.parent_name].filter(Boolean).join(" · ")}
              </span>
            </span>
            {s.owed > 0 ? <span className="tag tag-status" style={{ whiteSpace: "nowrap" }}>{money(s.owed)} owed</span> : <ChevronIcon />}
          </Link>
        ))}
      </div>
    </Screen>
  );
}
