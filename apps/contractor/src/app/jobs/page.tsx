import { redirect } from "next/navigation";
import { getMe } from "@/lib/me";
import { NextUp } from "@/components/NextUp";

export const dynamic = "force-dynamic";
export const metadata = { title: "My jobs" };

export default async function JobsPage() {
  const me = await getMe();
  if (!me.signed_in) redirect("/login?next=/jobs");
  return <NextUp tab="jobs" title="My jobs"
    lead="Every job you've taken, with its progress, its photos and what's owed. It arrives with the offer feed." />;
}
