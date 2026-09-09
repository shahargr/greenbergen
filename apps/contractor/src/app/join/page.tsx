import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { JoinForm } from "./JoinForm";

export const metadata = { title: "Join as a contractor" };
export const dynamic = "force-dynamic";

// Two people arrive here and they are not the same person.
//
// A STRANGER needs the sign-up form: name, company, phone, then a code.
//
// SOMEONE ALREADY SIGNED IN - a homeowner adding a trade, most often - must
// NOT be shown it. One Supabase Auth login already covers all four apps, so
// asking them to sign up again would either create a second account or fail
// confusingly. What they actually need is the contractor RECORD their account
// does not have yet, and contractor_register makes exactly that. It is
// idempotent, so arriving here twice is harmless.
//
// This was a real dead end: the switcher hid the contractor door from anyone
// who did not already hold it, and this page had no signed-in check, so there
// was no route from homeowner to contractor at all.
export default async function JoinPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as
    | { sub?: string; user_metadata?: { full_name?: string; name?: string } }
    | undefined;

  if (claims?.sub) {
    // The name is all we can know here; the company, phone and documents are
    // asked for on /business, which is where they belong anyway.
    await supabase.rpc("contractor_register", {
      p_full_name: claims.user_metadata?.full_name ?? claims.user_metadata?.name ?? null,
      p_company_name: null,
      p_phone: null,
    });
    redirect("/business?ok=registered");
  }

  return <JoinForm />;
}
