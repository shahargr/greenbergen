import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { SignIn } from "@shared/SignIn";
import { afterLoginUrl } from "@shared/site";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const safe = (n: string | undefined) => (n && n.startsWith("/") && !n.startsWith("//") ? n : null);

// The whole screen is shared now (apps/shared/src/SignIn.tsx) - this file only
// says what the footer offers a homeowner.
//
// WHERE IT LANDS IS NOT THIS APP'S DECISION any more. It used to be /project,
// which meant signing in here put you in the homeowner app however your
// settings read (Shahar, 2026-09-13: "per settings i was logged as
// professional, but landed on the home owner page"). /after-login is the one
// screen that reads my_doors() and app_users.default_door; an explicit ?next=
// still wins, because a deep link is somebody who already said where they
// were going.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await isSignedIn(await createClient())) redirect(safe(next) ?? afterLoginUrl());
  return <SignIn footer={<>New here? <Link href="/join">Join the community</Link></>} />;
}
