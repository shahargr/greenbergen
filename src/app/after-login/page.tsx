import { Suspense } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { createClient } from "@/lib/supabase/server";
import { landing } from "@/lib/doors";
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
  // A FRESH SIGN-IN IS ALWAYS YOU. An admin's view-as / act-as row
  // (admin_view_state) outlived sign-out for up to an hour, so signing back
  // in landed as the borrowed person - Shahar stuck as Alex (2026-09-28).
  // end_view_as() only ever deletes the caller's own row; for everyone
  // else it is a no-op.
  await supabase.rpc("end_view_as");
  const doors = await loadDoors();
  // "WHERE I WAS" RESUME IS OFF (Shahar 2026-09-28): it sent a re-sign-in
  // back into the previous seat's page. Migration 199 (my_last_place) and
  // RememberPlace stay in the tree for when it is rebuilt; a sign-in lands
  // on the door's own entry until then.
  return <GoTo href={landing(doors)} />;
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
