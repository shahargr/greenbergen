import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { SignIn } from "@shared/SignIn";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const safe = (n: string | undefined, home: string) => (n && n.startsWith("/") && !n.startsWith("//") ? n : home);

// Already signed in on this host? Nothing to ask - through to where you were
// going. This is what makes a hop from the door picker silent.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await isSignedIn(await createClient())) redirect(safe(next, "/work"));
  return <SignIn home="/work" footer={<>New here? <Link href="/join">Join as a contractor</Link></>} />;
}
