import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppBar, Card, Screen } from "@shared/ui";
import { getBoard, runs } from "@/lib/board";
import { Tidy } from "./Tidy";

export const dynamic = "force-dynamic";

// TIDY UP - the data-improvement process (Shahar, 2026-09-17). One task at a
// time, of the ones with no trade or no holder, with a guess to accept or
// ignore. The queue and the guesses are the database's (migration 173).
export default async function TidyPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  const to = back && back.startsWith("/") && !back.startsWith("//") ? back : `/project/${id}`;
  const board = await getBoard();
  if (!board.signed_in) redirect(`/login?next=/project/${id}/tidy`);
  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  // Somebody who does not run the job has nothing to tidy. Say so, the way
  // Set up does, rather than bouncing them back with no word of why.
  if (!runs(seat)) {
    return (
      <Screen>
        <AppBar back={to} title="Tidy up" sub={seat.project_name} />
        <div className="body">
          <Card soft pad>
            <div className="small">
              Tidying this project&apos;s tasks — filing them under a trade and a holder — belongs to whoever
              runs it. You can see everything on the job itself.
            </div>
          </Card>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar back={to} title={
        <span className="crumbs">
          <Link href={`/project/${id}`}>{seat.project_name}</Link>
          <span className="sep" aria-hidden>›</span>
          <span className="leaf">Tidy up</span>
        </span>
      } />
      <div className="body">
        <Tidy projectId={id} projectName={seat.project_name} back={to} />
      </div>
    </Screen>
  );
}
