import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMe } from "@/lib/me";
import { areaLine, loadContractors } from "@/lib/contractors";
import { townForZip } from "@shared/bergen";
import { shortDate } from "@shared/format";
import { AppBar, Avatar, Card, CheckIcon, Screen } from "@shared/ui";
import { Illustration } from "@shared/Illustrations";

export const dynamic = "force-dynamic";

// One contractor: what they do, where, how they have done, and - the point -
// what you can book from them. No phone, no email (see the list page).
export default async function ContractorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getMe();
  if (!me.signed_in) redirect(`/login?next=/contractors/${id}`);
  const [p] = await loadContractors(id);
  if (!p) notFound();
  const town = p.service_zip ? townForZip(p.service_zip) : null;
  const area = areaLine(p, town);

  return (
    <Screen>
      <AppBar back="/contractors" title={p.company ?? p.name} />
      <div className="body">
        <Card pad>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <Avatar name={p.company ?? p.name} />
            <div className="grow">
              <div className="card-title">{p.company ?? p.name}</div>
              {p.company && <div className="small text-muted">{p.name}</div>}
              {area && <div className="small text-muted">{area}</div>}
              {p.website && <div className="small"><a href={/^https?:/.test(p.website) ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer">{p.website.replace(/^https?:\/\//, "")}</a></div>}
            </div>
          </div>
        </Card>

        <Card pad>
          <h6 style={{ marginBottom: 6 }}>On Green Bergen</h6>
          <ul className="scope">
            <li><span className="ic"><CheckIcon size={18} /></span><span>Approved by Green Bergen{p.approved_at ? ` · ${shortDate(p.approved_at)}` : ""}</span></li>
            <li><span className="ic"><CheckIcon size={18} /></span><span>{p.jobs_done > 0 ? `${p.jobs_done} job${p.jobs_done === 1 ? "" : "s"} completed here` : "No jobs completed here yet"}{p.jobs_live > 0 ? ` · ${p.jobs_live} under way` : ""}</span></li>
            {p.rating && (
              <li><span className="ic"><CheckIcon size={18} /></span><span>{p.rating.provisional ? `Rating still settling in (${p.rating.responses} so far)` : `★ ${p.rating.score.toFixed(1)} from ${p.rating.responses} ${p.rating.responses === 1 ? "job" : "jobs"}`}</span></li>
            )}
          </ul>
        </Card>

        <Card pad>
          <h6 style={{ marginBottom: 6 }}>Trades</h6>
          {p.trades.length === 0 ? <p className="small text-muted" style={{ margin: 0 }}>None listed yet.</p> : (
            <ul className="scope">
              {p.trades.map((t) => (
                <li key={t.trade}><span className="ic"><CheckIcon size={18} /></span><span>{t.trade}{t.licence && <span className="detail"> — {t.licence}</span>}</span></li>
              ))}
            </ul>
          )}
        </Card>

        {/* The point of the page. You do not call them - you book the package
            at the community price and the first approved contractor in the
            trade to accept gets it, which may or may not be this one. */}
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">What you can book in their trades</div>
          {p.packages.length === 0 ? (
            <p className="small text-muted" style={{ margin: 0 }}>Nothing priced in these trades yet.</p>
          ) : (
            <div className="tiles quad">
              {p.packages.map((k) => (
                <Link key={k.code} href={`/packages/${k.code}`} className="tile">
                  <div className="art"><Illustration name={k.illustration} /></div>
                  <div className="card-title">{k.title}{k.line2 && <small>{k.line2}</small>}</div>
                </Link>
              ))}
            </div>
          )}
          <p className="tiny text-muted" style={{ margin: 0 }}>
            Booking goes to every approved contractor in the trade at the same price; the first to
            accept takes it. There is no way to pick one by name — that is what keeps the price honest.
          </p>
        </section>
      </div>
    </Screen>
  );
}
