import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

// Already signed in? There is nothing to ask - through to where you were
// headed. A deep link that bounced through here carries ?next=, and
// dropping it sent a signed-in person to their default door instead of the
// page they asked for (Shahar hit this 2026-09-23: a /my/project/.../finance
// link landed him on the /pro board). Only a same-origin path is honoured;
// anything else falls back to /after-login, which reads your seats and
// sends you on. The form only renders for someone who actually needs it.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { next } = await searchParams;
    const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
    redirect(safe ?? "/after-login");
  }
  return <LoginForm />;
}
