import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { safePath } from "@shared/site";
import { JoinForm } from "./JoinForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join" };

// Screen 2 - registration. Three fields, exactly three. An invite may
// pre-fill the name; the referral is never shown.
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ ref?: string; name?: string; next?: string }> }) {
  const { ref, name, next } = await searchParams;
  const supabase = await createClient();
  const after = safePath(next, "/welcome");
  if (await isSignedIn(supabase)) redirect(after);
  return <JoinForm refId={ref && /^[0-9a-f-]{36}$/i.test(ref) ? ref : null} prefillName={name ?? ""} next={after} />;
}
