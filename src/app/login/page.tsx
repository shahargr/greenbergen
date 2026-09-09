import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

// Already signed in? There is nothing to ask - through to /after-login,
// which reads your seats and sends you on (one seat: its app; more: the
// door picker). The landing page's "Sign in" therefore does the right thing
// for a returning visitor with a live session, and the form only renders
// for someone who actually needs it.
export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/after-login");
  return <LoginForm />;
}
