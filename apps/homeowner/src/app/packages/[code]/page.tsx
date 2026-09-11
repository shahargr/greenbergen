import { notFound } from "next/navigation";
import { decodeSelections, isHardware, loadCovered, loadPackage, type Package } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { getMe } from "@/lib/me";
import { AppBar, Card, CheckIcon, Screen } from "@shared/ui";
import { Illustration } from "@shared/Illustrations";
import { NotifyMe } from "./NotifyMe";
import { PackageConfigurator } from "./PackageConfigurator";
import { QuoteForm } from "./QuoteForm";
import { PackageVideo } from "./PackageVideo";
import { Claims, Faq } from "./PackageStory";

export const dynamic = "force-dynamic";

// THE PACKAGE PAGE, as a template every package uses.
//
// Shahar (2026-09-11) pointed at starlink.com and said the package page
// should be set up that way. That page is not a spec sheet with a buy button
// on it - it is a sequence, and the sequence is the argument:
//
//   1  the thing, full width, named, with one promise and the price
//   2  a run of bands that each make ONE point
//   3  the specifics - what is included, and what you buy yourself
//   4  the price again, now earned, with the scope you can move
//   5  the questions people actually ask
//   6  the ask, once more, at the bottom
//
//   ...and an order bar that follows you the whole way down.
//
// Everything except 2 and 5 already existed here. Those two are content -
// blueprint_package_sections (migration 067) - so this file is the template
// and the copy belongs to each package. A package with nothing written for it
// renders the same page with those bands missing, which is the right failure:
// no empty headings, no lorem, just a shorter page.
//
// THE HERO IS THE VIDEO when there is one (Shahar, 2026-09-10, on the EV
// charger: "the video can even replace the header large image"), else the
// photograph, else the line art. It now carries the name, the promise and
// the price rather than leaving them to a heading underneath.
function PackageHero({
  pkg, signedIn, tag, price, children,
}: {
  pkg: Package; signedIn: boolean; tag?: React.ReactNode; price?: number | null; children?: React.ReactNode;
}) {
  const media = (pkg.videos?.length ?? 0) > 0
    ? <PackageVideo videos={pkg.videos!} signedIn={signedIn} title={pkg.name} poster={pkg.photo_url ?? null} />
    : pkg.photo_url
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={pkg.photo_url} alt={pkg.name} />
      : <span className="art"><Illustration name={pkg.illustration} /></span>;

  return (
    <section className="pkg-top">
      <div className={`pkg-hero ${pkg.photo_url || (pkg.videos?.length ?? 0) > 0 ? "" : "art-only"}`}>
        {media}
        {tag}
      </div>
      <div className="pkg-lede">
        {pkg.trade && <div className="kicker">{pkg.trade}</div>}
        <h1>{pkg.name}</h1>
        {pkg.description && <p className="lead">{pkg.description}</p>}
        {price != null && (
          <p className="from">
            <span className="mono">{dollars(price)}</span>
            <span className="text-muted"> · {pkg.config_label ?? "most common setup"}</span>
          </p>
        )}
        {children}
      </div>
    </section>
  );
}

export default async function PackagePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ sel?: string; adjust?: string }> }) {
  const { code } = await params;
  const { sel, adjust } = await searchParams;
  // getMe carries signed_in and the homes the quote form's address list is
  // drawn from, so the separate signed-in read is gone.
  const [{ pkg }, me] = await Promise.all([loadPackage(code), getMe()]);
  const signedIn = me.signed_in;
  const homes = me.signed_in ? me.homes.map((h) => ({ project_id: h.project_id, address: h.address, name: h.name })) : [];
  if (!pkg) notFound();
  // Back goes where you came from - the landing rail, the grid, a project -
  // through the browser's history; the grid only when there is no page of
  // ours behind this one (a shared link). See BackButton.
  const back = { fallback: "/packages" };
  // Every tile is a link now, coming-soon ones included, so this page has to
  // answer for all of them. Coverage is a second, cheap cached read rather
  // than a field on the package: it changes when someone is approved, on a
  // different clock from the package itself.
  const covered = await loadCovered(pkg.trade);
  const sections = pkg.sections ?? [];

  // Coming soon used to 404 from here, because the tile that led to it was a
  // dead <div>. It is a link now, and a member who taps it deserves to read
  // what the job is and to say they want it - not a not-found page.
  if (pkg.availability === "coming_soon") {
    return (
      <Screen>
        <AppBar back={back} title={pkg.name} />
        <div className="body">
          <PackageHero pkg={pkg} signedIn={signedIn} tag={<span className="tag tag-neutral">Coming soon</span>} />
          <Card soft pad>
            <h2 style={{ margin: 0, fontSize: 19 }}>We&apos;re not ready to price this one.</h2>
            <p className="small" style={{ margin: "6px 0 0" }}>
              It is on the list. When we can put one honest number on it for everyone, it goes live here.
            </p>
          </Card>
          <Claims sections={sections} />
          <NotifyMe code={pkg.code} trade={pkg.trade} signedIn={signedIn} />
          <p className="tiny text-muted center" style={{ margin: 0 }}>
            No cost and no commitment — it tells us what to build next.
          </p>
          <Faq sections={sections} />
        </div>
      </Screen>
    );
  }

  if (pkg.availability !== "priced") {
    return (
      <Screen>
        <AppBar back={back} title={pkg.name} />
        <div className="body">
          <PackageHero pkg={pkg} signedIn={signedIn}
            tag={<span className="tag tag-outline">{pkg.availability === "quote" ? "Get a quote" : "Something else"}</span>} />
          <Card soft pad>
            <h2 style={{ margin: 0, fontSize: 19 }}>
              {pkg.availability === "quote" ? "This one gets a person, not a price." : "Tell us in a sentence."}
            </h2>
          </Card>
          <Claims sections={sections} />
          <QuoteForm code={pkg.code} signedIn={signedIn} homes={homes} />
          <Faq sections={sections} />
        </div>
      </Screen>
    );
  }

  const selections = decodeSelections(pkg, sel);

  // 3 - the specifics. Server-rendered and handed to the configurator, which
  // places them: it owns the selections, so it has to own the order of
  // everything the selections touch (see the note in that file).
  const story = (
    <>
      <Claims sections={sections} />

      <Card pad>
        <h6 style={{ marginBottom: 6 }}>What&apos;s included</h6>
        <ul className="scope">
          {pkg.items.filter((it) => !isHardware(it)).map((it, i) => (
            <li key={i}>
              <span className="ic"><CheckIcon size={18} /></span>
              <span>{it.label}{it.detail && <span className="detail"> — {it.detail}</span>}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* WHAT YOU BUY (054). The hardware the price does not include - the
          generator, the switch, the pad - each with the suggested product
          page at the stores, so the number above is honest and the
          shopping is one tap. */}
      {pkg.items.some(isHardware) && (
        <Card pad>
          <h6 style={{ marginBottom: 2 }}>What you buy</h6>
          <p className="small text-muted" style={{ margin: "0 0 6px" }}>Not in the price. Order it to the house before the crew comes; these are the models our contractors install most.</p>
          <ul className="scope">
            {pkg.items.filter(isHardware).map((it, i) => (
              <li key={i} style={{ flexWrap: "wrap" }}>
                <span className="ic"><CartIcon /></span>
                <span className="grow">
                  {it.label}{it.detail && <span className="detail"> — {it.detail}</span>}
                  {(it.links?.length ?? 0) > 0 && (
                    <span className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                      {it.links!.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="btn btn-soft" style={{ minHeight: 34, fontSize: 12.5 }}>{l.label} ↗</a>
                      ))}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );

  return (
    <Screen>
      <AppBar back={back} title={pkg.name} />
      <div className="body">
        <PackageHero pkg={pkg} signedIn={signedIn} price={pkg.base_price_cents}
          tag={pkg.requires_permit ? <span className="tag tag-accent">Permit package</span> : undefined} />

        <PackageConfigurator pkg={pkg} initial={selections} signedIn={signedIn} openAdjust={adjust === "1"} covered={covered}
          story={story} faq={<Faq sections={sections} />} />
      </div>
    </Screen>
  );
}

// A small cart, for the lines the homeowner buys.
const CartIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 8H6.2" />
    <circle cx="9.5" cy="20" r="1.3" /><circle cx="17.5" cy="20" r="1.3" />
  </svg>
);
