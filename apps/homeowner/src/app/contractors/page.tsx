import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/me";
import { areaLine, loadContractors } from "@/lib/contractors";
import { townForZip } from "@shared/bergen";
import { AppBar, Avatar, Card, ChevronIcon, Screen, ShellIcons } from "@shared/ui";
import { unreadForShell } from "@shared/unread";

export const dynamic = "force-dynamic";
export const metadata = { title: "The contractors" };

// THE DIRECTORY. Every contractor Green Bergen has approved - the same set
// an offer can reach - with their trades, where they work and their record
// here. Filter by trade (?trade=) to answer the question a member actually
// has: "who does water heaters?"
//
// Deliberately no phone or email: the community price and the match are the
// product, and a directory that hands out numbers is a lead list, which is
// the thing contractors were promised they would not be on. You book the
// package; the first approved contractor in the trade to accept gets it.
export default async function ContractorsPage({ searchParams }: { searchParams: Promise<{ trade?: string }> }) {
  const { trade } = await searchParams;
  const [me, pros] = await Promise.all([getMe(), loadContractors()]);
  if (!me.signed_in) redirect("/login?next=/contractors");
  // Everything waiting on you, not just the booking conversations: the old
  // count missed offers, questions and anything else addressed to you.
  // my_unread_count() is the same predicate the inbox list calls `pending`.
  const unread = await unreadForShell();

  const trades = [...new Set(pros.flatMap((p) => p.trades.map((t) => t.trade)))].sort();
  const pick = trade && trades.includes(trade) ? trade : null;
  const shown = pick ? pros.filter((p) => p.trades.some((t) => t.trade === pick)) : pros;

  return (
    <Screen>
      <AppBar brand right={<ShellIcons unread={unread} />} />
      <div className="body">
        <div className="hero">
          <h1>The contractors</h1>
          <p className="lead">
            Everyone here has been looked at by Green Bergen — licence, insurance, a conversation —
            and takes work at the community price. You don&apos;t call them; you book the package and
            the first one in the trade to accept is yours.
          </p>
        </div>

        {trades.length > 1 && (
          <nav className="chips" aria-label="Filter by trade">
            <Link href="/contractors" className={`tag ${pick ? "tag-neutral" : ""}`} style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }}>All · {pros.length}</Link>
            {trades.map((t) => (
              <Link key={t} href={`/contractors?trade=${encodeURIComponent(t)}`} className={`tag ${pick === t ? "" : "tag-neutral"}`} style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }}>
                {t} · {pros.filter((p) => p.trades.some((x) => x.trade === t)).length}
              </Link>
            ))}
          </nav>
        )}

        {shown.length === 0 ? (
          <Card soft pad>
            <div className="card-title">{pick ? `Nobody approved in ${pick} yet` : "Nobody approved yet"}</div>
            <p className="small text-muted" style={{ margin: "4px 0 0" }}>
              The roster is exactly who an offer can reach today. Open a package and ask to be told
              when someone covers it — that is what tells us which trade to go find next.
            </p>
          </Card>
        ) : (
          <section className="stack" style={{ gap: 8 }}>
            {shown.map((p) => {
              const town = p.service_zip ? townForZip(p.service_zip) : null;
              const area = areaLine(p, town);
              return (
                <Link key={p.id} href={`/contractors/${p.id}`} className="home-row">
                  <Avatar name={p.company ?? p.name} />
                  <span className="grow">
                    <span className="t">{p.company ?? p.name}</span>
                    <span className="m" style={{ display: "block" }}>
                      {p.trades.map((t) => t.trade).join(", ") || "No trade listed"}
                      {area ? ` · ${area}` : ""}
                    </span>
                    <span className="m" style={{ display: "block" }}>
                      {p.rating && !p.rating.provisional ? `★ ${p.rating.score.toFixed(1)} · ` : ""}
                      {p.jobs_done > 0 ? `${p.jobs_done} job${p.jobs_done === 1 ? "" : "s"} done here` : "New to Green Bergen"}
                      {p.jobs_live > 0 ? ` · ${p.jobs_live} under way` : ""}
                    </span>
                  </span>
                  <ChevronIcon />
                </Link>
              );
            })}
          </section>
        )}
      </div>
    </Screen>
  );
}
