import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { SignIn } from "@shared/SignIn";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const safe = (n: string | undefined, home: string) => (n && n.startsWith("/") && !n.startsWith("//") ? n : home);

// No join link: a builder seat arrives when a project makes you its PM or GC,
// so there is nothing to sign up for (doors.ts, NOT_SELF_SERVE).
// Already signed in on this host? Nothing to ask - through to where you were
// going. This is what makes a hop from the door picker silent.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await isSignedIn(await createClient())) redirect(safe(next, "/"));
  return <SignIn home="/" footer={<Link href="https://greenbergen.vercel.app">The owner portal</Link>} />;
}
