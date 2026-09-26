import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { stopwatch } from "@shared/perf";
import { AppBar, Notice, Screen } from "@shared/ui";
import { coverUrls, getBoard, runs } from "@/lib/board";
import type { Spine } from "@/components/TradeSpine";
import { SiteVisits, type Visit } from "../SiteVisits";
import { VisitDesk, type VisitBoard } from "./VisitDesk";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site visit" };

// THE SITE VISIT, AS ITS OWN SCREEN.
//
// Shahar (2026-09-25), on the tile that did nothing: "site visit does not
// work. under site visit, GC/PM should be able to: log tasks (simple ones,
// and assign to traders working on site, self); see all activities by each
// trader working on site; log a financial transaction, permit conversation,
// learning; view each active trader's status; log bidding information
// (pricing, scope, etc); log photos of today's visit; open tasks by trader;
// punch list by trader. think what else you need to show on this."
//
// The tile DID something - it lit the visits panel - but that panel draws at
// the foot of the project screen, under the trades and the day's tasks, so
// the tap looked like nothing. This is the walk-round in one place instead:
// what you write down while standing there at the top, what needs your eye
// under it, then every trade that is live with its work, its punch list and
// its week. The database reads it in one call (portal_site_visit_board,
// migration 238) beside the spine and the visit log that already existed.
export default async function SiteVisitPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const { ok, error } = await searchParams;
  const w = stopwatch("/project/[id]/visit");
  const supabase = await createClient();
  const [board, { data: deskData, error: deskErr }, { data: spineData }, { data: visitData }] = await Promise.all([
    w.step("board", () => getBoard()),
    w.step("desk", () => rpc<VisitBoard>(supabase, "portal_site_visit_board", { p_project: id })),
    w.step("spine", () => rpc<Spine>(supabase, "portal_project_trades", { p_project: id })),
    w.step("visits", () => rpc<Visit[]>(supabase, "portal_site_visits", { p_project: id, p_limit: 20 })),
  ]);
  if (!board.signed_in) redirect(`/login?next=${encodeURIComponent(`/project/${id}/visit`)}`);
  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();

  const here = `/project/${id}/visit`;
  const desk = deskData && deskData.ok ? deskData : null;
  if (!seat.address || !desk) {
    return (
      <Screen>
        <AppBar back={`/project/${id}`} title="Site visit" sub={seat.project_name ?? undefined} />
        <div className="body">
          <Notice kind="error">
            {!seat.address
              ? "This project has no site of its own - open the property or the job to log a visit."
              : deskData?.reason ?? (deskErr ? `The site visit did not load: ${deskErr.message}` : "The site visit did not load.")}
          </Notice>
        </div>
      </Screen>
    );
  }

  const spine: Spine = spineData && Array.isArray(spineData.trades)
    ? spineData : { trades: [], untagged: { open: 0, late: 0 } };
  const visits = Array.isArray(visitData) ? visitData : [];
  const signed = await w.step("media", () => coverUrls(supabase, visits.flatMap((v) => v.files.map((f) => f.path))));
  w.done();

  return (
    <Screen>
      <AppBar back={`/project/${id}`} title="Site visit" sub={seat.project_name ?? undefined} />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}
        {ok === "visit" && <div className="banner-ok">Logged. You&apos;re on today&apos;s roster.</div>}
        {ok === "visit-edit" && <div className="banner-ok">Changed.</div>}
        {ok === "visit-gone" && <div className="banner-ok">Removed. Anything you attached stays on the project.</div>}

        <VisitDesk projectId={id} back={here} manages={runs(seat)} desk={desk} trades={spine.trades}
          visit={
            // TODAY'S NOTE AND PHOTOS - the record that you were here, which
            // is also what puts you on the day's roster.
            <SiteVisits projectId={id} visits={visits} urls={signed} back={here}
              canLog={!!board.me?.contact_id} today={desk.today} address={seat.address ?? null} />
          } />
      </div>
    </Screen>
  );
}
