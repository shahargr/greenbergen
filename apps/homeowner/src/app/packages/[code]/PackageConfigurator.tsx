"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { configLabel, deltaNotes, depositCents, encodeSelections, priceFor, type Package, type Selections } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { Card, NumberedNotes } from "@shared/ui";
import { PriceBlock } from "@shared/PriceBlock";
import { AdjustPanel } from "./AdjustPanel";
import { NotifyMe } from "./NotifyMe";

// Screen 5b + 6: price, "adjust it", good-to-know, book. The price moves
// live as levers change; the formula stays hidden.
//
// covered = is anyone approved to do this trade. When nobody is, the price is
// still real and DIY still works - what cannot happen is turn-key, because the
// offer would go out and reach nobody. So the turn-key button becomes "tell me
// when someone covers this" and DIY becomes the primary act. The price stays
// on screen either way: a member deciding whether to do it themselves needs
// the number more, not less.
export function PackageConfigurator({ pkg, initial, signedIn, openAdjust, covered = true }: { pkg: Package; initial: Selections; signedIn: boolean; openAdjust: boolean; covered?: boolean }) {
  const [sel, setSel] = useState<Selections>(initial);
  const [open, setOpen] = useState(openAdjust);
  const price = priceFor(pkg, sel);
  const deposit = depositCents(pkg, price);
  const deltas = useMemo(() => deltaNotes(pkg, sel), [pkg, sel]);
  const isDefault = deltas.length === 0 && configLabel(pkg, sel) === (pkg.config_label ?? "most common setup");

  // A visitor goes straight into the wizard too: the account is created at
  // its last step, not before the first (Shahar, 2026-09-10).
  const bookHref = `/packages/${pkg.code}/book?sel=${encodeURIComponent(encodeSelections(sel))}`;
  const planHref = `${bookHref}&mode=plan`;

  const notes: React.ReactNode[] = [];
  if (!covered) {
    notes.push(<>This price is real and it is the community price — but no approved contractor covers {pkg.trade ? pkg.trade.toLowerCase() : "this trade"} on Green Bergen yet, so we cannot hand it to anyone today.</>);
    notes.push(<>You can still start it as a DIY project. It keeps the scope and today&apos;s price as your reference, and switches to turn-key the moment someone covers it.</>);
  }
  if (pkg.requires_permit) {
    notes.push(<>A town permit is required. Your contractor meets you to sign the papers.</>);
    notes.push(<>{pkg.permit_deposit_pct}% ({dollars(deposit)}) is due when the permit process begins — paid to the contractor, not to us.</>);
    notes.push(<>Permits take a few weeks. Matching a contractor usually takes a day or two.</>);
  } else {
    notes.push(<>Nothing is charged today. You pay the contractor when the work is done — card, check or cash.</>);
    notes.push(<>First to accept at this price gets it; nobody can counter-offer, and there is no deadline on your side.</>);
  }
  if (!pkg.instant_book && pkg.approval_note) notes.push(<>{pkg.approval_note}</>);

  return (
    <>
      <Card pad={false}>
        <PriceBlock cents={price} was={isDefault ? null : pkg.base_price_cents} config={configLabel(pkg, sel)} delta={deltas} pulse
          kicker={isDefault ? "Community price · most common setup" : "Updated price"} />
      </Card>

      {/* Two verbs right under the price (Shahar, 2026-09-10): order it as
          it stands, or refine the scope first. Order goes straight into
          the wizard; when nobody covers the trade yet, the same button
          starts it as a DIY project, which is what actually works today. */}
      <div className="row" style={{ gap: 8 }}>
        <Link href={covered ? bookHref : planHref} className="btn btn-primary" style={{ flex: 1 }}>{covered ? "Order now" : "Start as DIY"}</Link>
        <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setOpen(true)}>Refine scope</button>
      </div>

      <div>
        <h6>Good to know</h6>
        <NumberedNotes items={notes} />
      </div>

      {/* Nobody covers it yet and no session: "tell me when it opens" is a
          whole account step, so it lives here in the flow. The sticky bar
          below is for buttons only; a form inside it floated over the page. */}
      {!covered && !signedIn && (
        <div className="stack" style={{ gap: 6 }}>
          <NotifyMe code={pkg.code} trade={pkg.trade} signedIn={signedIn} />
          <p className="tiny text-muted center" style={{ margin: 0 }}>No cost and no commitment — it tells us which trade to go find next.</p>
        </div>
      )}

      {/* Two ways to take this on, named and equal. The old screen made one
          the button and the other a reluctant "not yet", which framed doing
          it yourself as failing to buy - when it is a real choice, and the
          one a lot of people want. Either can become the other later. */}
      <div className="actions" style={{ padding: 0, marginTop: 8 }}>
        <div className="divider-label">How do you want to take it on?</div>

        {covered ? (
          <>
            <Link href={bookHref} className="btn btn-primary btn-block">
              {pkg.instant_book ? `Turn-key · ${dollars(price)}` : `Turn-key · request at ${dollars(price)}`}
            </Link>
            <p className="small text-muted center" style={{ margin: "0 0 6px" }}>
              We match the contractor and hold this price. Next: your address, then{" "}
              {pkg.photos.length === 1 ? "one photo" : `${["", "one", "two", "three", "four"][pkg.photos.length] ?? pkg.photos.length} photos`}. No payment today.
            </p>

            <Link href={planHref} className="btn btn-secondary btn-block">Add to my DIY projects</Link>
            <p className="tiny text-muted center" style={{ margin: 0 }}>
              Yours to do, at your pace. Keeps the scope and today&apos;s price as your reference, and
              nothing goes to contractors. Switch it to turn-key whenever you want.
            </p>
          </>
        ) : (
          // The two swap places. DIY is the thing that actually works today,
          // so it leads; turn-key is not offered as a button that would post a
          // job to an empty room.
          <>
            <Link href={planHref} className="btn btn-primary btn-block">Add to my DIY projects</Link>
            <p className="small text-muted center" style={{ margin: "0 0 6px" }}>
              Yours to do, at your pace, with the scope and today&apos;s price kept as your
              reference. It becomes turn-key the day we can hand it over.
            </p>

            {signedIn && (
              <>
                <NotifyMe code={pkg.code} trade={pkg.trade} signedIn={signedIn} />
                <p className="tiny text-muted center" style={{ margin: 0 }}>
                  No cost and no commitment — it tells us which trade to go find next.
                </p>
              </>
            )}
          </>
        )}
      </div>

      {open && <AdjustPanel pkg={pkg} value={sel} onChange={setSel} onClose={() => setOpen(false)} />}
    </>
  );
}
