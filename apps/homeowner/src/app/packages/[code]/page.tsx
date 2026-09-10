import { notFound } from "next/navigation";
import { decodeSelections, isHardware, loadCovered, loadPackage, type Package } from "@shared/catalogue";
import { getMe } from "@/lib/me";
import { AppBar, Card, CheckIcon, Screen } from "@shared/ui";
import { Illustration } from "@shared/Illustrations";
import { NotifyMe } from "./NotifyMe";
import { PackageConfigurator } from "./PackageConfigurator";
import { QuoteForm } from "./QuoteForm";
import { PackageVideo } from "./PackageVideo";

export const dynamic = "force-dynamic";

// Screen 5 - the money screen. The work itself at the top - the explainer
// video when the package has one, else the photograph, else the line art -
// then the scope, then the price: the number must feel earned by everything
// above it.
//
// THE HEADER IS THE VIDEO (Shahar, 2026-09-10, on the EV charger: "the
// video can even replace the header large image"). One version per viewer
// out of however many Admin set up, what they do with it counted; the
// package photograph is its poster. Before this the video sat in the second
// half of the screen and the header ignored the photograph altogether.
function PackageHero({ pkg, signedIn, children }: { pkg: Package; signedIn: boolean; children?: React.ReactNode }) {
  if ((pkg.videos?.length ?? 0) > 0) {
    return <div className="pkg-hero"><PackageVideo videos={pkg.videos!} signedIn={signedIn} title={pkg.name} poster={pkg.photo_url ?? null} />{children}</div>;
  }
  if (pkg.photo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <div className="pkg-hero"><img src={pkg.photo_url} alt={pkg.name} />{children}</div>;
  }
  return <div className="illus"><Illustration name={pkg.illustration} />{children}</div>;
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

  // Coming soon used to 404 from here, because the tile that led to it was a
  // dead <div>. It is a link now, and a member who taps it deserves to read
  // what the job is and to say they want it - not a not-found page.
  if (pkg.availability === "coming_soon") {
    return (
      <Screen>
        <AppBar back={back} title={pkg.name} />
        <div className="body">
          <PackageHero pkg={pkg} signedIn={signedIn}><span className="tag tag-neutral">Coming soon</span></PackageHero>
          <div className="hero">
            <h1>We&apos;re not ready to price this one.</h1>
            <p className="lead">{pkg.description ?? "It is on the list. When we can put one honest number on it for everyone, it goes live here."}</p>
          </div>
          <NotifyMe code={pkg.code} trade={pkg.trade} signedIn={signedIn} />
          <p className="tiny text-muted center" style={{ margin: 0 }}>
            No cost and no commitment — it tells us what to build next.
          </p>
        </div>
      </Screen>
    );
  }

  if (pkg.availability !== "priced") {
    return (
      <Screen>
        <AppBar back={back} title={pkg.name} />
        <div className="body">
          <PackageHero pkg={pkg} signedIn={signedIn}><span className="tag tag-outline">{pkg.availability === "quote" ? "Get a quote" : "Something else"}</span></PackageHero>
          <div className="hero">
            <h1>{pkg.availability === "quote" ? "This one gets a person, not a price." : "Tell us in a sentence."}</h1>
            <p className="lead">{pkg.description}</p>
          </div>
          <QuoteForm code={pkg.code} signedIn={signedIn} homes={homes} />
        </div>
      </Screen>
    );
  }

  const selections = decodeSelections(pkg, sel);
  return (
    <Screen>
      <AppBar back={back} title={pkg.name} />
      <div className="body">
        <PackageHero pkg={pkg} signedIn={signedIn}>{pkg.requires_permit && <span className="tag tag-accent">Permit package</span>}</PackageHero>

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

        <PackageConfigurator pkg={pkg} initial={selections} signedIn={signedIn} openAdjust={adjust === "1"} covered={covered} />
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
