import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asksFirst, decodeSelections, encodeSelections, loadCovered, loadDiyList, loadPackage, priceFor } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { AppBar, Card, Screen } from "@shared/ui";
import { usesEvFlow } from "@/lib/ev";
import { priced as withViewerMarkup } from "@/lib/markup";

export const dynamic = "force-dynamic";
export const metadata = { title: "How do you want to take it on?" };

// ONE DOOR INTO A JOB, THEN THE FORK (Shahar, 2026-09-20): "once a user
// clicks it, you will take him through quick next next next protocol asking
// a. price it as DIY project and as end to end project. b. add this project
// to my list. c. diy happy path & purchase happy path."
//
// The package page used to end in two buttons side by side and a paragraph
// under each, which asks somebody to compare two offers before they have
// decided they want the job at all. This is the step between: one screen
// that says what each way actually costs and commits to, and then the same
// two wizards that already work.
//
// WHAT IT DOES NOT DO IS INVENT A DIY PRICE, and that is the honest part.
// blueprint_package_items carries no price, cost or labour column, and
// blueprint_package_products - the parts list - has two rows across one
// package. So a "DIY $420" printed beside a real community price would be a
// number somebody decides on and we made up. Until a package carries its own
// materials figure, the DIY side says what is true: the scope and today's
// price are your reference, and the parts are yours to buy.
export default async function TakePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ sel?: string }> }) {
  const { code } = await params;
  const { sel } = await searchParams;
  const [{ pkg: raw }, diy] = await Promise.all([loadPackage(code), loadDiyList(code)]);
  const pkg = raw ? await withViewerMarkup(raw) : null;
  if (!pkg) notFound();

  const selections = decodeSelections(pkg, sel);
  const price = priceFor(pkg, selections);
  const q = sel ? `?sel=${encodeURIComponent(sel)}` : `?sel=${encodeURIComponent(encodeSelections(selections))}`;
  const bookHref = `/packages/${code}/book${q}`;
  const planHref = `${bookHref}&mode=plan`;
  const priced = pkg.availability === "priced";
  // A gas job asks its survey first, a guided package walks its photos, and
  // both end in this same fork - turn-key or DIY - so they skip this screen
  // (migrations 235, 236). The EV charger asks it on its own step 3, beside
  // the wall it goes on (lib/ev.ts).
  // Only while someone covers the trade: without a contractor, turn-key would
  // reach nobody, and this screen says so.
  if (priced && (asksFirst(pkg) || usesEvFlow(pkg)) && (await loadCovered(pkg.trade))) redirect(bookHref);

  return (
    <Screen>
      <AppBar back={`/packages/${code}`} title={pkg.tile_title ?? pkg.name} sub="How do you want to take it on?" />
      <div className="body">
        <div className="hero">
          <h1>Two ways to get this done.</h1>
          <p className="lead">
            Same scope either way. Pick one now — you can switch later, and nothing you have
            done is lost when you do.
          </p>
        </div>

        {/* END TO END. The only real number on the screen, and it is the one
            the community negotiated. */}
        <Card pad>
          <div className="kicker">We run it end to end</div>
          <div className="big mono" style={{ margin: "2px 0 0" }}>{priced ? dollars(price) : "Quoted"}</div>
          <p className="small text-muted" style={{ margin: "4px 0 10px" }}>
            {priced
              ? "The community price, held for you. We match an approved contractor, they carry the insurance and the warranty, and you approve the work as it goes."
              : "This one is priced per job. We take the scope to approved contractors and come back with real numbers."}
          </p>
          <Link href={bookHref} className="btn btn-primary btn-block">Have it done for me</Link>
        </Card>

        {/* DIY. No fabricated figure - see the note at the top of this file.
            What it offers now is the package's DIY list (migration 241): the
            how-to written for the person doing it, open to read before they
            commit to anything. */}
        <Card pad>
          <div className="kicker">I do it myself</div>
          <div className="big mono" style={{ margin: "2px 0 0" }}>Parts + your time</div>
          <p className="small text-muted" style={{ margin: "4px 0 10px" }}>
            {diy
              ? `You get the DIY list: ${diy.steps.length} steps, from what to check before you buy anything to how you know it is done, with the steps a licensed pro should do marked. `
              : "You get a checklist for the job, in order. "}
            {priced ? `${dollars(price)} stays on it as your reference, so you always know what you are saving.` : ""}{" "}
            Nothing goes to any contractor.
          </p>
          {diy && <Link href={`/packages/${code}/diy${q}`} className="btn btn-soft btn-block" style={{ marginBottom: 8 }}>Read the DIY list first</Link>}
          <Link href={planHref} className="btn btn-secondary btn-block">Add it to my list as DIY</Link>
        </Card>

        <p className="tiny text-muted center" style={{ margin: "4px 0 0" }}>
          Either way it goes on your list at the next step, against the home you choose.
        </p>
      </div>
    </Screen>
  );
}
