import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Screen } from "@shared/ui";
import { getBoard, runs } from "@/lib/board";
import { TradeSpine, type Spine } from "@/components/TradeSpine";

export const dynamic = "force-dynamic";

// ONE PANEL OF THE JOB: its trades, as tiles.
//
// Shahar (2026-09-17): "club all rough trades under rough, and finish trades
// under finish. this will reduce the number of panels significantly." The
// project screen shows the panels (migration 168); this is what one opens
// to - the trades inside it, four across in build order, each a door to the
// trade's own screen. Nothing here is new: it is the tile grid the project
// screen drew before, narrowed to one group.
export default async function PanelPage({
  params, searchParams,
}: {
  params: Promise<{ id: string; panel: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id, panel: raw } = await params;
  const { back } = await searchParams;
  const panel = decodeURIComponent(raw);
  const to = back && back.startsWith("/") && !back.startsWith("//") ? back : `/project/${id}`;

  const w = stopwatch("/project/[id]/group/[panel]");
  const supabase = await createClient();
  const [board, { data: spineData }] = await Promise.all([
    w.step("board", () => getBoard()),
    w.step("spine", () => rpc<Spine>(supabase, "portal_project_trades", { p_project: id })),
  ]);
  w.done();
  if (!board.signed_in) redirect(`/login?next=/project/${id}/group/${raw}`);
  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  const manages = runs(seat);
  const spine: Spine = spineData && Array.isArray(spineData.trades)
    ? spineData : { trades: [], untagged: { open: 0, late: 0 } };
  const inPanel = spine.trades.filter((t) => (t.panel ?? t.stage ?? "Running the job") === panel);
  const here = `/project/${id}/group/${encodeURIComponent(panel)}?back=${encodeURIComponent(to)}`;

  return (
    <Screen>
      <AppBar back={to} title={
        <span className="crumbs">
          <Link href={`/project/${id}`}>{seat.project_name}</Link>
          <span className="sep" aria-hidden>›</span>
          <span className="leaf">{panel}</span>
        </span>
      } />
      <div className="body">
        {inPanel.length === 0 ? (
          <Card soft pad>
            <div className="small">Nothing on this job sits under {panel} yet.</div>
            <Link href={to} className="btn btn-ghost btn-block" style={{ marginTop: 10 }}>Go back</Link>
          </Card>
        ) : (
          <TradeSpine projectId={id} spine={spine} manages={manages} mode="tiles" only={panel}
            back={here} allTasksHref={`/tasks?project=${id}&back=${encodeURIComponent(here)}`} />
        )}
      </div>
    </Screen>
  );
}
