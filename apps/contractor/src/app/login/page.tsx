import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { SignIn } from "@shared/SignIn";
import { afterLoginUrl } from "@shared/site";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const safe = (n: string | undefined) => (n && n.startsWith("/") && !n.startsWith("//") ? n : null);

// Where it lands is /after-login, not /work: the one screen that reads
// my_doors() and app_users.default_door, so all three sign-in screens give
// the same answer (Shahar, 2026-09-13). An explicit ?next= still wins.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await isSignedIn(await createClient())) redirect(safe(next) ?? afterLoginUrl());
  return <SignIn footer={<>New here? <Link href="/join">Join as a contractor</Link></>} />;
}
