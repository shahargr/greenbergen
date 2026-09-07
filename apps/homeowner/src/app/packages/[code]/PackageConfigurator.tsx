"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { configLabel, deltaNotes, depositCents, encodeSelections, priceFor, type Package, type Selections } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { Blueprint, NumberedNotes } from "@shared/ui";
import { PriceBlock } from "@shared/PriceBlock";
import { AdjustPanel } from "./AdjustPanel";

// Screen 5b + 6: price, "adjust it", good-to-know, book. The price moves
// live as levers change; the formula stays hidden.
export function PackageConfigurator({ pkg, initial, signedIn, openAdjust }: { pkg: Package; initial: Selections; signedIn: boolean; openAdjust: boolean }) {
  const [sel, setSel] = useState<Selections>(initial);
  const [open, setOpen] = useState(openAdjust);
  const price = priceFor(pkg, sel);
  const deposit = depositCents(pkg, price);
  const deltas = useMemo(() => deltaNotes(pkg, sel), [pkg, sel]);
  const isDefault = deltas.length === 0 && configLabel(pkg, sel) === (pkg.config_label ?? "most common setup");

  const bookPath = `/packages/${pkg.code}/book?sel=${encodeURIComponent(encodeSelections(sel))}`;
  const bookHref = signedIn ? bookPath : `/join?next=${encodeURIComponent(bookPath)}`;

  const notes: React.ReactNode[] = [];
  if (pkg.requires_permit) {
    notes.push(<>A town permit is required. Your contractor meets you to sign the papers.</>);
    notes.push(<>{pkg.permit_deposit_pct}% ({dollars(deposit)}) is due when the permit process begins — paid to the contractor, not to us.</>);
    notes.push(<>Permits take a few weeks. Matching a contractor takes at least 24 hours.</>);
  } else {
    notes.push(<>Nothing is charged today. You pay the contractor when the work is done — card, check or cash.</>);
    notes.push(<>Matching a contractor takes at least 24 hours. First to accept at this price gets it; nobody can counter-offer.</>);
  }
  if (!pkg.instant_book && pkg.approval_note) notes.push(<>{pkg.approval_note}</>);

  return (
    <>
      <Blueprint pad={false}>
        <PriceBlock cents={price} was={isDefault ? null : pkg.base_price_cents} config={configLabel(pkg, sel)} delta={deltas} pulse
          kicker={isDefault ? "Community price · most common setup" : "Updated price"} />
      </Blueprint>

      <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: 0 }} onClick={() => setOpen(true)}>
        Not what you need? <strong style={{ marginLeft: 4 }}>Adjust it.</strong>
      </button>

      <div>
        <h6>Good to know</h6>
        <NumberedNotes items={notes} />
      </div>

      <div className="actions" style={{ padding: 0, marginTop: 8 }}>
        <Link href={bookHref} className="btn btn-primary btn-block blueprint">
          {pkg.instant_book ? `Book at ${dollars(price)}` : `Request at ${dollars(price)}`}
        </Link>
        <p className="small text-muted center" style={{ margin: 0 }}>
          Next: your address, then {pkg.photos.length === 1 ? "one photo" : `${["", "one", "two", "three", "four"][pkg.photos.length] ?? pkg.photos.length} photos`}. No payment today.
        </p>
      </div>

      {open && <AdjustPanel pkg={pkg} value={sel} onChange={setSel} onClose={() => setOpen(false)} />}
    </>
  );
}
