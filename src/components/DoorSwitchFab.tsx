import { createClient } from "@/lib/supabase/server";
import { DoorSwitchFabButton } from "./DoorSwitchFabButton";

// Nothing at all for a visitor. The portal's root layout runs on the public
// pages too, and the front of the site has no business carrying a control
// only a signed-in person could use - so the session is checked here, on the
// server, and the button below never reaches the browser otherwise.
export async function DoorSwitchFab() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? null) as { sub?: string } | null;
  if (!claims?.sub) return null;
  return <DoorSwitchFabButton current="admin" />;
}
