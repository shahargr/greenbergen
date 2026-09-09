import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { dollars } from "@shared/format";
import { AppBar, Card, ChevronIcon, Notice, Screen } from "@shared/ui";
import { Illustration } from "@shared/Illustrations";
import { setPackage } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packages" };

// THE PACKAGES IN YOUR TRADES. Shahar: "a contractor with the right trade
// should have a way to see the packages and sign up to service these.
// contractor can see the suggested price (as approved by other vendors),
// and call a different price to win more jobs."
//
// One row per package whose trade you hold. Open it to read what the
// basic setup includes, what the levers add, what the community price is
// and what accepted jobs have gone for - then sign up, and name your own
// price for the basic setup if it differs. A called price below the
// community price earns FIRST REFUSAL on new jobs (migration 046, Shahar's
// option 2): the lowest call is invited alone for a window, then the job
// opens to the trade. The homeowner always pays the community price.
type Pkg = {
  code: string; name: string; tile_title: string; trade: string; availability: string;
  base_price_cents: number | null; config_label: string | null; illustration: string | null; requires_permit: boolean;
  items: { label: string; detail: string | null; kind: string }[];
  levers: { label: string; options: { label: string; price_delta_cents: number; is_default: boolean }[] }[];
  mine: { status: string; price_cents: number | null; note: string | null; since: string } | null;
  others: number;
  accepted_at: { n: number; low: number | null; high: number | null } | null;
};

const delta = (c: number) => (c === 0 ? "included" : `${c > 0 ? "+" : "−"}${dollars(Math.abs(c))}`);

export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login?next=/packages");
  const { data } = await rpc<Pkg[]>(supabase, "expert_packages");
  const pkgs = Array.isArray(data) ? data : [];
  const serving = pkgs.filter((p) => p.mine?.status === "active").length;

  return (
    <Screen>
      <AppBar back="/work" title="Packages in your trades" />
      <div className="body">
        {ok && <div className="banner-ok">{ok}</div>}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="hero">
          <h1>{pkgs.length === 0 ? "No packages in your trades yet." : `${pkgs.length} ${pkgs.length === 1 ? "package" : "packages"} in your trades.`}</h1>
          <p className="lead">
            {pkgs.length === 0
              ? "Pick your trades first - packages follow the trade."
              : `Each one is a basic setup at the community price, plus upgrades at cost. Sign up to the ones you serve${serving ? ` · serving ${serving}` : ""}.`}
          </p>
        </div>
        {pkgs.length === 0 && <Link href="/business/trades?from=work" className="btn btn-primary btn-block">Your trades</Link>}

        {pkgs.map((p) => {
          const on = p.mine?.status === "active";
          const acc = p.accepted_at && p.accepted_at.n > 0 ? p.accepted_at : null;
          return (
            <details key={p.code} id={p.code} className="home-panel">
              <summary className="home-row" style={{ alignItems: "flex-start" }}>
                <span className="ic" aria-hidden style={{ width: 40, height: 40 }}>{p.illustration && <Illustration name={p.illustration} />}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t">{p.name}</span>
                  <span className="m" style={{ display: "block" }}>
                    {p.base_price_cents != null ? `${dollars(p.base_price_cents)} community price` : "No fixed price - a person looks first"}
                    {" · "}{p.others} {p.others === 1 ? "other serves" : "others serve"} it
                  </span>
                  <span style={{ display: "block", marginTop: 6 }}>
                    {on
                      ? <span className="tag tag-status">Serving{p.mine?.price_cents != null ? ` at ${dollars(p.mine.price_cents)}` : ""}</span>
                      : p.mine ? <span className="tag tag-neutral">Paused</span> : <span className="tag tag-outline">Not signed up</span>}
                  </span>
                </span>
                <span className="chev"><ChevronIcon /></span>
              </summary>
              <div className="drawer stack" style={{ gap: 12, paddingTop: 12 }}>
                {p.config_label && <p className="small" style={{ margin: 0 }}><strong>Basic setup:</strong> {p.config_label}.</p>}

                <div>
                  <div className="divider-label">What it includes</div>
                  <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {p.items.filter((i) => i.kind !== "assurance").map((i, n) => <li key={n}>{i.label}{i.detail ? <span className="text-muted"> · {i.detail}</span> : null}</li>)}
                  </ul>
                  {p.items.some((i) => i.kind === "assurance") && (
                    <p className="tiny text-muted" style={{ margin: "6px 0 0" }}>Comes with: {p.items.filter((i) => i.kind === "assurance").map((i) => i.label.toLowerCase()).join(", ")}.</p>
                  )}
                </div>

                {p.levers.length > 0 && (
                  <div>
                    <div className="divider-label">Upgrades, at cost</div>
                    <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                      {p.levers.map((l, n) => (
                        <p key={n} className="small" style={{ margin: 0 }}>
                          <strong>{l.label}:</strong>{" "}
                          {l.options.map((o, i) => <span key={i}>{i > 0 ? " · " : ""}{o.label} <span className="text-muted">({delta(o.price_delta_cents)})</span></span>)}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <Card soft pad>
                  <div className="kicker">The suggested price</div>
                  <p className="small" style={{ margin: "4px 0 0" }}>
                    {p.base_price_cents != null
                      ? <>The community price for the basic setup is <strong>{dollars(p.base_price_cents)}</strong>. {acc
                          ? <>{acc.n} accepted {acc.n === 1 ? "job has" : "jobs have"} gone for {acc.low === acc.high ? dollars(acc.low) : `${dollars(acc.low)} to ${dollars(acc.high)}`}.</>
                          : "No accepted jobs on it yet."}</>
                      : "This package has no fixed price; a person quotes each job."}
                  </p>
                </Card>

                <form action={setPackage} className="stack" style={{ gap: 10 }}>
                  <input type="hidden" name="code" value={p.code} />
                  {p.base_price_cents != null && (
                    <label className="field">
                      <span className="field-label">Your price for the basic setup <span className="text-muted">(optional)</span></span>
                      <input className="input" name="price" inputMode="decimal" placeholder={`${(p.base_price_cents / 100).toFixed(0)} is the community price`}
                        defaultValue={p.mine?.price_cents != null ? (p.mine.price_cents / 100).toFixed(0) : ""} />
                      <p className="hint">Leave it blank to work at the community price. Call a lower one and new jobs on this package come to you first: the lowest call gets first refusal for a window before the job opens to the trade. The homeowner still pays the community price.</p>
                    </label>
                  )}
                  <label className="field">
                    <span className="field-label">A note <span className="text-muted">(optional)</span></span>
                    <input className="input" name="note" placeholder="Bergen County only · Generac and Kohler" defaultValue={p.mine?.note ?? ""} />
                  </label>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-primary grow" name="on" value="1">{on ? "Save" : "Sign up to serve it"}</button>
                    {on && <button className="btn btn-ghost" name="on" value="0">Pause</button>}
                  </div>
                </form>
              </div>
            </details>
          );
        })}
      </div>
    </Screen>
  );
}
