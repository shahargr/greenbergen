import { redirect } from "next/navigation";
import { getMe } from "@/lib/me";
import { NextUp } from "@/components/NextUp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  const me = await getMe();
  if (!me.signed_in) redirect("/login?next=/inbox");
  return <NextUp tab="inbox" title="Inbox"
    lead="Messages from homeowners, questions you've asked before pricing, and anything the community needs from you." />;
}
