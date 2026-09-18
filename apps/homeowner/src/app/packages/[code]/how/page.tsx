import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPackage, loadPackageProcess } from "@shared/catalogue";
import { AppBar, Card, Screen } from "@shared/ui";

export const dynamic = "force-dynamic";

// HOW THE JOB ACTUALLY GOES, step by step (Shahar, 2026-09-18: "users can
// access step by step DIY process as well").
//
// The same steps the office follows, in the same order, out of the same
// library - not a marketing summary written beside it. The database drops the
// steps marked ours only (homeowner_package_process), so an internal note
// never has to live somewhere else to stay internal.
//
// It opens with the TRADES the work needs, because that is the honest answer
// to "can I do this myself": the generator needs a licensed plumber and a
// licensed electrician whoever is running it, and a project manager only if
// you would rather not run it. Every step then says whose hand it is.
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const p = await loadPackageProcess(code);
  return { title: p ? `${p.name} - how it goes` : "How it goes" };
}

export default async function PackageProcessPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [proc, { pkg }] = await Promise.all([loadPackageProcess(code), loadPackage(code)]);
  if (!pkg) notFound();

  const back = `/packages/${code}`;

  if (!proc) {
    return (
      <Screen>
        <AppBar back={back} title="How it goes" />
        <div className="body">
          <Card soft pad>
            <h2 style={{ margin: 0, fontSize: 19 }}>We haven&apos;t written this one down yet.</h2>
            <p className="small" style={{ margin: "6px 0 0" }}>
              The step-by-step for {pkg.name} isn&apos;t published. Book it and we run it; ask us and we&apos;ll
              walk you through it.
            </p>
          </Card>
          <p className="center"><Link className="btn btn-soft" href={back}>Back to {pkg.name}</Link></p>
        </div>
      </Screen>
    );
  }

  const required = proc.trades.filter((t) => t.need === "required");
  const optional = proc.trades.filter((t) => t.need === "optional");

  return (
    <Screen>
      <AppBar back={back} title="How it goes" sub={proc.name} />
      <div className="body">
        <Card pad>
          <div className="kicker">{proc.steps.length} steps</div>
          <h1 style={{ fontSize: 22, margin: "4px 0 6px" }}>{proc.process}</h1>
          <p className="small text-muted" style={{ margin: 0 }}>
            This is the whole job, in the order it actually happens — the same list our office works from.
            Read it before you decide. Do it yourself, or book it and we run it for you.
          </p>
        </Card>

        {/* WHO THE WORK NEEDS. Equals, not a chain: each trade is licensed,
            hired and paid on its own; the sequence between them is the work
            somebody has to do. */}
        <Card pad>
          <h6 style={{ marginBottom: 6 }}>Who this needs</h6>
          <ul className="how-trades">
            {required.map((t) => (
              <li key={t.trade}>
                <span className="how-trade">{t.trade}</span>
                <span className="tag tag-accent">needed</span>
                {t.note && <span className="small text-muted how-note">{t.note}</span>}
              </li>
            ))}
            {optional.map((t) => (
              <li key={t.trade}>
                <span className="how-trade">{t.trade}</span>
                <span className="tag tag-outline">optional</span>
                {t.note && <span className="small text-muted how-note">{t.note}</span>}
              </li>
            ))}
          </ul>
          {required.length > 0 && (
            <p className="tiny text-muted" style={{ margin: "8px 0 0" }}>
              Every trade marked needed is licensed work and pulls its own permit — that part is not a
              do-it-yourself step, whoever is running the job.
            </p>
          )}
        </Card>

        {proc.steps.map((st, i) => (
          <Card key={st.n ?? i} pad className="how-step">
            <div className="how-head">
              <span className="how-n">{i + 1}</span>
              <div className="grow">
                <h6 style={{ margin: 0 }}>{st.step}</h6>
                <div className="how-tags">
                  <span className="tag tag-neutral">{st.trade ?? "us, or you"}</span>
                  {st.is_gate && <span className="tag tag-accent">nothing moves until this passes</span>}
                  {st.only_if && <span className="tag tag-outline">only in some houses</span>}
                </div>
              </div>
            </div>
            {st.why && <p className="small how-why">{st.why}</p>}
            {st.photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={st.photo} alt="" className="how-photo" />
            )}
            {st.asks && (
              <p className="tiny text-muted" style={{ margin: "6px 0 0" }}>
                Write down when it is done: {st.asks}
                {st.answers && st.answers.length > 0 && ` (${st.answers.join(" or ")})`}
              </p>
            )}
          </Card>
        ))}

        <Card soft pad>
          <h6 style={{ marginBottom: 4 }}>Rather not run it?</h6>
          <p className="small" style={{ margin: "0 0 10px" }}>
            Book it and we hire the trades, hold the sequence and close the permits. One price, and you read
            the same list from the inside.
          </p>
          <Link className="btn btn-primary btn-block" href={back}>Back to {pkg.name}</Link>
        </Card>
      </div>
    </Screen>
  );
}
