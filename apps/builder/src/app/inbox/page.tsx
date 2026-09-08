import { redirect } from "next/navigation";
import { getBoard } from "@/lib/me";
import { NextUp } from "@/components/NextUp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  const b = await getBoard();
  if (!b.signed_in) redirect("/login?next=/inbox");
  return <NextUp tab="inbox" step="step 7 of apps/builder/BUILD.md"
    title="Inbox" lead="Messages, invitations to projects, and anything waiting on an answer from you." />;
}
