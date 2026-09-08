import { NextResponse, type NextRequest } from "next/server";
import { landing, loadDoors } from "@/lib/doors";

// The one place a successful sign-in lands, whichever way it arrived: the
// emailed code (the login form pushes here), the magic link and Google
// (both come through /auth/confirm). Putting the decision here rather than
// in each of the three means they can never disagree.
//
// An explicit ?next= still wins everywhere it did before - this is only the
// DEFAULT destination, so a deep link into the portal keeps working.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const to = landing(await loadDoors());
  // An absolute door URL leaves this origin; a path stays on it.
  return NextResponse.redirect(to.startsWith("http") ? to : new URL(to, request.url));
}
