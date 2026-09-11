import Link from "next/link";
import { ChevronIcon } from "@shared/ui";
import { money } from "@/lib/board";

// WHO IS ON SITE THIS WEEK, one panel per trade. Shahar (2026-09-11): "show a
// panel for every trade working on site this week, allowing to click on it
// and drill down to its tasks / payments / etc."
//
// A trade is here this week if someone of that trade was marked on the roster
// in the week, or there is open work in that trade dated inside it - either
// alone lies (see portal_site_week, migration 068). Each panel leads to
// everything about that trade on this site.
export type SiteWeekTrade = {
  trade: string;
  phase: string | null;
  days_on_site: number;
  people: { contact_id: string; name: string }[];
  due_this_week: number;
  late: number;
  open: number;
  contracts: { id: string; title: string; amount: number | null; paid: number | null }[];
};
export type SiteWeek = { ok: boolean; from: string; to: string; money: boolean; trades: SiteWeekTrade[] };

// "Sep 8" - the project screen names the week on the panel and again above
// this list, so the two say it the same way.
export const weekDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function SiteWeekTrades({ projectId, week }: { projectId: string; week: SiteWeek | null }) {
  const trades = week?.trades ?? [];
  if (!week?.ok) {
    return (
      <div className="card soft pad">
        <div className="small">This project has no site of its own, so nobody is on it.</div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {trades.length === 0 && (
        <div className="card soft pad">
          <div className="small">
            No trade is booked or marked on site this week. A trade appears here when someone of that
            trade logs a visit, or when work in that trade is dated inside the week.
          </div>
        </div>
      )}

      {trades.map((t) => {
        const agreed = t.contracts.reduce((n, c) => n + (c.amount ?? 0), 0);
        const paid = t.contracts.reduce((n, c) => n + (c.paid ?? 0), 0);
        const owed = agreed - paid;
        return (
          <Link key={t.trade} href={`/project/${projectId}/trade/${encodeURIComponent(t.trade)}`} className="home-row">
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{t.trade}</span>
              <span className="m" style={{ display: "block" }}>
                {[
                  t.days_on_site > 0 ? `${t.days_on_site} ${t.days_on_site === 1 ? "day" : "days"} on site` : null,
                  t.people.length > 0 ? t.people.map((p) => p.name).join(", ") : null,
                  t.due_this_week > 0 ? `${t.due_this_week} due` : null,
                  week.money && owed > 0 ? `${money(owed)} owed` : null,
                  t.phase,
                ].filter(Boolean).join(" · ") || `${t.open} open`}
              </span>
            </span>
            {t.late > 0 && <span className="tag tag-status" style={{ whiteSpace: "nowrap" }}>{t.late} late</span>}
            <ChevronIcon />
          </Link>
        );
      })}
    </div>
  );
}
