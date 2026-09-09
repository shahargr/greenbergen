import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/me";
import { loadOffer } from "@/lib/offers";
import { askedText, loadQuestions } from "@shared/offer/questions";
import { replyInThread } from "@shared/offer/actions";
import { dollars, shortDate } from "@shared/format";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { acceptOffer, askAboutOffer, passOffer } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "An offer" };

// AN OFFER, OPENED. Shahar: "once open, you should see the project, accept
// as is, accept but asking for more details (price is not approved), or
// archive (not interest)."
//
// So the screen is the job first and the buttons last, and the three ways
// out are named for what they actually do:
//
//   Accept at the community price  - homeowner_offer_accept. First wins.
//   Ask before you accept          - homeowner_offer_ask. NOT an acceptance:
//                                    the price is not agreed and nothing
//                                    about your position changes.
//   Not interested                 - homeowner_offer_decline.
//
// TOWN ONLY, and said out loud. homeowner_offers() never returns an address
// (migration 008), so this screen cannot leak one even by accident - but a
// person deciding whether to drive somewhere deserves to be told why they
// cannot see where, rather than left to notice it missing.
export default async function OfferPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const { ok, error } = await searchParams;
  const [me, offer, questions] = await Promise.all([getMe(), loadOffer(id), loadQuestions()]);
  if (!me.signed_in) redirect(`/login?next=/offer/${id}`);
  // A question I raised on this job, if there is one. Its state decides
  // whether the ask box or the answer is on the screen.
  const q = questions.find((x) => x.project_id === id && x.mine) ?? null;
  // Gone means taken, passed or withdrawn - all of which read the same to
  // the person holding a stale link, and none of which is an error.
  if (!offer) {
    return (
      <Screen>
        <AppBar back="/inbox" title="That offer has closed" />
        <div className="body">
          <Card pad>
            <div className="card-title">It is no longer open.</div>
            <p className="small text-muted" style={{ margin: "4px 0 0" }}>
              Someone took it, or it was withdrawn. Nothing was held against you for not answering.
            </p>
          </Card>
        </div>
        <div className="actions"><Link href="/work" className="btn btn-primary btn-block">Back to work</Link></div>
      </Screen>
    );
  }

  const scope = offer.scope ?? [];
  const asked = ok === "asked";

  return (
    <Screen>
      <AppBar back="/inbox" title={offer.package} sub={offer.town ?? undefined} />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}
        {asked && (
          <div className="banner-ok">
            Your question is with us. The offer stays open and the price is not agreed — you have given nothing up.
          </div>
        )}

        <div className="hero">
          <h1>{offer.package}</h1>
          <p className="lead">
            {[offer.trade, offer.town, offer.config_label].filter(Boolean).join(" · ")}
          </p>
        </div>

        {offer.first_refusal_until && (
          <Notice title="You have first refusal on this one.">
            You called the lowest price for this package&apos;s basic setup, so it is yours alone until{" "}
            {new Date(offer.first_refusal_until).toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" })}.
            After that it opens to every {offer.trade ?? ""} contractor in the community. The job is still at the community price.
          </Notice>
        )}

        <Card pad={false}>
          <div className="price">
            <div className="kicker">The community price</div>
            <div className="big mono">{dollars(offer.price_cents)}</div>
            <div className="delta">
              {offer.config_label ?? "the most common setup"}
              {offer.reply_by ? ` · reply by ${shortDate(offer.reply_by)}` : ""}
            </div>
          </div>
        </Card>

        {scope.length > 0 && (
          <Card pad>
            <div className="kicker">What the job is</div>
            <ul className="scope" style={{ marginTop: 4 }}>
              {scope.map((s, i) => <li key={i}><span className="ic">·</span><span>{s}</span></li>)}
            </ul>
          </Card>
        )}

        <Card soft pad>
          <div className="kv-rows" style={{ padding: "2px 0" }}>
            <div><span className="k">Where</span><span>{offer.town ?? "Bergen County"} — the address is shared the moment you accept</span></div>
            <div><span className="k">Photos</span><span>{offer.photos > 0 ? `${offer.photos} from the homeowner` : "None yet"}</span></div>
            <div><span className="k">Posted</span><span>{offer.posted_at ? shortDate(offer.posted_at) : "—"}</span></div>
          </div>
        </Card>

        {!me.can_accept && (
          <Notice title="You can look, but you can't accept yet.">
            Your licence and certificates have to be on file and approved first.{" "}
            <Link href="/business/documents">Finish that</Link> and this button comes alive.
          </Notice>
        )}

        {/* ACCEPT AS IS. The only one of the three that commits you. */}
        <form action={acceptOffer.bind(null, id, me.profile.contact_id ?? "")}>
          <button className="btn btn-primary btn-block" disabled={!me.can_accept || !me.profile.contact_id}>
            Accept at {dollars(offer.price_cents)}
          </button>
        </form>
        <p className="tiny text-muted" style={{ margin: "-4px 0 0" }}>
          First to accept gets it. That writes the contract and the payment stages, releases the address to you,
          and tells the other {offer.trade?.toLowerCase() ?? "trades"} it is gone.
        </p>

        {/* ASK, and then what came of it. Deliberately NOT next to Accept,
            and deliberately not called "accept with conditions" - nothing is
            accepted here. Once asked, this space becomes the state of the
            question, because a second ask box under a pending one is how you
            get four copies of the same question. */}
        {q?.state === "asked" && (
          <Card soft pad>
            <div className="row" style={{ alignItems: "center", gap: 10 }}>
              <span className="tag tag-status">Asked</span>
              <span className="small text-muted">Waiting on the homeowner.</span>
            </div>
            <p className="small" style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{askedText(q)}</p>
            <p className="tiny text-muted" style={{ margin: "8px 0 0" }}>
              The offer is still open to everyone it went to, and still yours to accept while you wait.
            </p>
          </Card>
        )}

        {q?.state === "open" && (
          <Card pad>
            <div className="row" style={{ alignItems: "center", gap: 10 }}>
              <span className="tag tag-ok">Answered</span>
              <span className="small text-muted">Their reply is in your inbox.</span>
            </div>
            <form action={replyInThread} className="stack" style={{ gap: 8, marginTop: 10 }}>
              <input type="hidden" name="base" value={`/offer/${id}`} />
              <input type="hidden" name="action" value={q.action_id} />
              <textarea className="input" name="body" rows={2} required placeholder="Write back about this job…" />
              <button className="btn btn-secondary btn-block">Send</button>
            </form>
            <p className="tiny text-muted" style={{ margin: "8px 0 0" }}>
              This thread is about this job and closes with it. The price is still the community price,
              and the address still comes with accepting.
            </p>
          </Card>
        )}

        {q?.state === "declined" && (
          <Card soft pad>
            <div className="row" style={{ alignItems: "center", gap: 10 }}>
              <span className="tag tag-neutral">Not answered</span>
              <span className="small text-muted">They would rather not say before someone accepts.</span>
            </div>
            <p className="tiny text-muted" style={{ margin: "8px 0 0" }}>
              The offer is still yours to take or leave.
            </p>
          </Card>
        )}

        {!q && (
          <details className="home-panel" style={{ marginTop: 4 }}>
            <summary className="home-row">
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">Ask before you accept</span>
                <span className="m" style={{ display: "block" }}>Something you need to know first — the price stays unagreed.</span>
              </span>
              <span className="chev">›</span>
            </summary>
            <div className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
              <form action={askAboutOffer.bind(null, id)} className="stack" style={{ gap: 8 }}>
                <textarea className="input" name="note" rows={3} required
                          placeholder="How far is the panel from the meter? Is there an existing gas line?" />
                <button className="btn btn-secondary btn-block">Send the question</button>
              </form>
              <p className="tiny text-muted" style={{ margin: 0 }}>
                This is a question, not a bid and not an acceptance. <strong>The community price is not agreed</strong>,
                the offer stays open to everyone it went to, and <strong>the address stays withheld</strong> until
                someone accepts. It goes to the homeowner, who is the only one who knows the answer.
              </p>
            </div>
          </details>
        )}

        {/* PASS. Last, quiet, and honest about being one-way. */}
        <form action={passOffer.bind(null, id)} style={{ marginTop: 4 }}>
          <button className="btn btn-ghost btn-block">Not interested</button>
        </form>
        <p className="tiny text-muted" style={{ margin: "-4px 0 12px" }}>
          It leaves your list and stays open for everyone else. Nothing is held against you.
        </p>
      </div>
    </Screen>
  );
}
