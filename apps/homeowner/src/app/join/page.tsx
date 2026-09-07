import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { JoinForm } from "./JoinForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join" };

// Screen 2 - registration. Three fields, exactly three. An invite may
// pre-fill the name; the referral is never shown.
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ ref?: string; name?: string; next?: string }> }) {
  const { ref, name, next } = await searchParams;
  const supabase = await createClient();
  if (await isSignedIn(supabase)) redirect(next && next.startsWith("/") ? next : "/welcome");
  return <JoinForm refId={ref && /^[0-9a-f-]{36}$/i.test(ref) ? ref : null} prefillName={name ?? ""} next={next && next.startsWith("/") ? next : "/welcome"} />;
}
