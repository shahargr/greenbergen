import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDiyList, loadPackage } from "@shared/catalogue";
import { AppBar, Notice, Screen } from "@shared/ui";
import { DiyListView, DiyPayCard } from "@/components/DiyListView";

export const dynamic = "force-dynamic";
export const metadata = { title: "DIY list" };

// THE DIY LIST, FOR ANYONE (Shahar, 2026-09-25; migration 241).
//
// "DIY scope should be cleared for ALL packages, and instead, a detailed DIY
// list should be provided." The contractor's scope says who files the permit
// and who carries the insurance - on a job you do yourself none of that is
// true. This is the list written for the person doing it: what to check
// first, what to buy, the work in order, and how to know it is done.
//
// Open to everyone, signed in or not. The suggested price is paid by Venmo
// if the reader wants to; nothing is recorded (his call).
export default async function DiyListPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ sel?: string }> }) {
  const { code } = await params;
  const { sel } = await searchParams;
  const [{ pkg }, list] = await Promise.all([loadPackage(code), loadDiyList(code)]);
  if (!pkg || !list) notFound();
  const q = sel ? `?sel=${encodeURIComponent(sel)}` : "";
  const planHref = `/packages/${code}/book${q}${q ? "&" : "?"}mode=plan`;
  const pro = list.steps.filter((s) => s.needs_pro).length;

  return (
    <Screen>
      <AppBar back={{ fallback: `/packages/${code}` }} title={pkg.tile_title ?? pkg.name} sub="The DIY list" />
      <div className="body">
        <div className="hero">
          <h1>Doing it yourself: {pkg.tile_title}.</h1>
          <p className="lead">
            {list.steps.length} steps, from what to check before you buy anything to how you know it is done.
            {pkg.requires_permit ? " This job needs a town permit - it is in the list, in the right place." : ""}
          </p>
        </div>

        {pro > 0 && (
          <Notice title={pro === 1 ? "One step is for a licensed pro" : `${pro} steps are for a licensed pro`}>
            They are marked. The list still says how they are done, so you know what you are paying for when you hire them.
          </Notice>
        )}

        <DiyListView list={list} />

        <DiyPayCard list={list} name={pkg.name} />

        {/* Not the sticky .actions bar: it would sit on top of the list
            being read. The ask comes once, after it. */}
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          {pkg.availability === "priced" && (
            <Link href={planHref} className="btn btn-secondary btn-block">Add it to my DIY projects</Link>
          )}
          <p className="tiny text-muted center" style={{ margin: 0 }}>
            On your list it becomes a checklist you tick as you go. Nothing is sent to any contractor.
          </p>
          {pkg.availability === "priced" && (
            <Link href={`/packages/${code}${q}`} className="btn btn-ghost btn-block">Or have it done for you</Link>
          )}
        </div>
      </div>
    </Screen>
  );
}
