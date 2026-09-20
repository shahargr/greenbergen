import { Suspense } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { createClient } from "@/lib/supabase/server";
import { doorForDb, landing, landingDoor } from "@/lib/doors";
import { loadDoors } from "@/lib/doors.server";
import { GoTo } from "./GoTo";

// The one place a successful sign-in lands, whichever way it arrived: the
// emailed code (the login form pushes here), the magic link and Google (both
// come through /auth/confirm). Putting the decision here rather than in each
// of the three means they can never disagree.
//
// An explicit ?next= still wins everywhere it did before - this is only the
// DEFAULT destination, so a deep link into the portal keeps working.
//
// IT IS A PAGE NOW, NOT A ROUTE HANDLER, and the reason is the hourglass: a
// redirect has no document, so there was nothing to look at while this
// resolved. See GoTo.tsx. The shell below flushes before the reads start,
// which is what Suspense is doing here - without it the server would hold the
// whole response until my_doors() answered and the blank window would be
// exactly as long as before.
export const dynamic = "force-dynamic";

export const metadata = { title: "Signing you in" };

async function Decide() {
  const supabase = await createClient();
  const doors = await loadDoors();
  // THE DOOR FIRST, THEN THE JOB, and the order is forced: the memory is per
  // door (migration 198), so there is nothing to ask for until we know which
  // seat this sign-in lands in. Two round trips instead of one, on a screen
  // that is already painting - see GoTo.tsx.
  const door = landingDoor(doors);
  // my_last_project is RLS-bound, so a revoked seat or a trashed project
  // comes back null and landing() falls through to the door's own entry.
  const last = door
    ? await supabase.rpc("my_last_project", { p_door: doorForDb(door) })
    : null;
  return <GoTo href={landing(doors, last && !last.error ? (last.data as string | null) : null)} />;
}

export default function AfterLogin() {
  return (
    <>
      <LoadingScreen />
      <Suspense fallback={null}>
        <Decide />
      </Suspense>
    </>
  );
}
