import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { decodeSelections, findPackage, loadCatalogue } from "@/lib/catalogue";
import { AppBar, Blueprint, CheckIcon, Screen } from "@/components/ui";
import { Illustration } from "@/components/Illustrations";
import { PackageConfigurator } from "./PackageConfigurator";
import { QuoteForm } from "./QuoteForm";

export const dynamic = "force-dynamic";

// Screen 5 - the money screen. Illustration, then the scope, then the price
// - the number must feel earned by everything above it.
export default async function PackagePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ sel?: string; adjust?: string }> }) {
  const { code } = await params;
  const { sel, adjust } = await searchParams;
  const supabase = await createClient();
  const [{ packages }, { data: auth }] = await Promise.all([loadCatalogue(supabase), supabase.auth.getUser()]);
  const pkg = findPackage(packages, code);
  if (!pkg || pkg.availability === "coming_soon") notFound();
  const back = pkg.tile_group === "more" ? "/packages/more" : "/packages";

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
          <QuoteForm code={pkg.code} signedIn={!!auth.user} />
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

        <Blueprint pad>
          <h6 style={{ marginBottom: 6 }}>What&apos;s included</h6>
          <ul className="scope">
            {pkg.items.map((it, i) => (
              <li key={i}>
                <span className="ic"><CheckIcon size={18} /></span>
                <span>{it.label}{it.detail && <span className="detail"> — {it.detail}</span>}</span>
              </li>
            ))}
          </ul>
        </Blueprint>

        <PackageConfigurator pkg={pkg} initial={selections} signedIn={!!auth.user} openAdjust={adjust === "1"} />
      </div>
    </Screen>
  );
}
