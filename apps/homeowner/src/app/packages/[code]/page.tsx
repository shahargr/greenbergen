import { notFound } from "next/navigation";
import { decodeSelections, loadCovered, loadPackage } from "@shared/catalogue";
import { getMe } from "@/lib/me";
import { AppBar, Card, CheckIcon, Screen } from "@shared/ui";
import { Illustration } from "@shared/Illustrations";
import { NotifyMe } from "./NotifyMe";
import { PackageConfigurator } from "./PackageConfigurator";
import { QuoteForm } from "./QuoteForm";

export const dynamic = "force-dynamic";

// Screen 5 - the money screen. Illustration, then the scope, then the price
// - the number must feel earned by everything above it.
export default async function PackagePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ sel?: string; adjust?: string }> }) {
  const { code } = await params;
  const { sel, adjust } = await searchParams;
  // getMe carries signed_in and the homes the quote form's address list is
  // drawn from, so the separate signed-in read is gone.
  const [{ pkg }, me] = await Promise.all([loadPackage(code), getMe()]);
  const signedIn = me.signed_in;
  const homes = me.signed_in ? me.homes.map((h) => ({ project_id: h.project_id, address: h.address, name: h.name })) : [];
  if (!pkg) notFound();
  // One catalogue screen now, so one place to go back to. tile_group no longer
  // decides which drawer a package came out of, because there is no drawer.
  const back = "/packages";
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
          <div className="illus">
            <Illustration name={pkg.illustration} />
            <span className="tag tag-neutral">Coming soon</span>
          </div>
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
          <div className="illus">
            <Illustration name={pkg.illustration} />
            <span className="tag tag-outline">{pkg.availability === "quote" ? "Get a quote" : "Something else"}</span>
          </div>
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
        <div className="illus">
          <Illustration name={pkg.illustration} />
          {pkg.requires_permit && <span className="tag tag-accent">Permit package</span>}
        </div>

        <Card pad>
          <h6 style={{ marginBottom: 6 }}>What&apos;s included</h6>
          <ul className="scope">
            {pkg.items.map((it, i) => (
              <li key={i}>
                <span className="ic"><CheckIcon size={18} /></span>
                <span>{it.label}{it.detail && <span className="detail"> — {it.detail}</span>}</span>
              </li>
            ))}
          </ul>
        </Card>

        <PackageConfigurator pkg={pkg} initial={selections} signedIn={signedIn} openAdjust={adjust === "1"} covered={covered} />
      </div>
    </Screen>
  );
}
