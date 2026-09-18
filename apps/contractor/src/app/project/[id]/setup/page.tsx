import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { AppBar, Card, Screen } from "@shared/ui";
import { getBoard, runs, topLevels } from "@/lib/board";
import { ProjectSetup } from "../ProjectSetup";
import { Lifecycle } from "./Lifecycle";

export const dynamic = "force-dynamic";

// SET-UP IS A SCREEN, NOT A PANEL (Shahar, 2026-09-18: "when inside a
// project, the gear button should move us into a new setting page rather
// than add a panel").
//
// It used to open in place on ?setup=1: the running screen stayed underneath,
// the panel pushed the spine and today-and-tomorrow down the page, and the
// way out was a "Done" link that only looked like a back button. Everything
// here is a one-time decision - the photo, the scope, when the house sells,
// how the job ends - and none of it belongs on top of the screen you use to
// run the work. So the gear navigates, the app bar's back arrow is the way
// out, and the running screen is left alone.
//
// It re-reads rather than being handed state: a screen you reach by URL has
// to stand on its own, and the three reads here are the cheap ones (the
// board, which is cached for the shell anyway; the scope summary; the
// money roll-up).
type ScopeTrade = { trade: string; scope_lines: number; chosen: boolean };
type Rollup = { owed: number | null; paid: number | null };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const board = await getBoard();
  const seat = board.seats.find((s) => s.project_id === id);
  return { title: seat ? `Set up · ${seat.project_name}` : "Set up" };
}

export default async function ProjectSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [board, { data: scopeData }, { data: rollupData }] = await Promise.all([
    getBoard(),
    rpc<ScopeTrade[]>(supabase, "portal_scope_trades", { p_project: id }),
    rpc<Rollup>(supabase, "portal_finance_rollup", { p_project_id: id }),
  ]);
  if (!board.signed_in) redirect(`/login?next=/project/${id}/setup`);

  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  const manages = runs(seat);
  const back = `/project/${id}`;

  // Somebody who does not run the job has nothing to set here. The database
  // would refuse every write on this screen; saying so is kinder than a page
  // of controls that all fail.
  if (!manages) {
    return (
      <Screen>
        <AppBar back={back} title="Set up" sub={seat.project_name} />
        <div className="body">
          <Card soft pad>
            <div className="small">
              Setting this project up — the photo, the scope, and how it ends — belongs to whoever runs it.
              You can see everything on the job itself.
            </div>
          </Card>
        </div>
      </Screen>
    );
  }

  // The same family arithmetic the project screen does, and for the same
  // reason: a property carries no tasks of its own, so "what is still open
  // here" only means anything across everything beneath it.
  const family = new Set<string>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of board.seats) {
      if (s.parent_project_id && family.has(s.parent_project_id) && !family.has(s.project_id)) {
        family.add(s.project_id); grew = true;
      }
    }
  }
  const openHere = board.tasks.filter((t) => t.project_id && family.has(t.project_id) && t.state === "open").length;
  const liveKids = board.seats.filter((s) => s.parent_project_id === id && !s.status.startsWith("Closed")).length;

  const roll = rollupData ?? null;
  const owed = roll?.owed ?? seat.owed ?? 0;
  const scopeLines = (scopeData ?? []).reduce((n, t) => n + t.scope_lines, 0);
  const scopeTrades = (scopeData ?? []).filter((t) => t.chosen).length;
  const closedAlready = seat.status.startsWith("Closed");

  // WHEN THIS HOUSE SELLS (migration 162): only on the property at the top of
  // its family, and only for whoever may set them. A job beneath inherits.
  // topLevels is what decides which project IS the property - the same
  // reading the project screen uses, so the two cannot disagree about which
  // one holds the days.
  const isProperty = !!seat.address && topLevels(board.seats).map.get(id)?.project_id === id;
  const { data: saleData } = isProperty
    ? await rpc<{ good: string | null; bad: string | null }[]>(supabase, "project_sale_targets", { p_project: id })
    : { data: null };
  const sale = isProperty ? { good: saleData?.[0]?.good ?? null, bad: saleData?.[0]?.bad ?? null } : null;

  return (
    <Screen>
      <AppBar back={back} title="Set up" sub={seat.project_name} />
      <div className="body">
        <ProjectSetup projectId={id} own={seat.cover_own} stock={!!seat.cover_url} canEdit
          scopeLines={scopeLines} scopeTrades={scopeTrades} sale={sale}
          lifecycle={
            <Lifecycle projectId={id} status={seat.status} closed={closedAlready}
              owns={seat.rank >= 70} archived={seat.archived}
              open={openHere} liveKids={liveKids} owed={owed} paid={roll?.paid ?? 0}
              superadmin={!!board.me?.is_superadmin} />
          } />
      </div>
    </Screen>
  );
}
