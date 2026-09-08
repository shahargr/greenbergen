import { redirect } from "next/navigation";
import { getBoard } from "@/lib/me";
import { NextUp } from "@/components/NextUp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money" };

export default async function MoneyPage() {
  const b = await getBoard();
  if (!b.signed_in) redirect("/login?next=/money");
  return <NextUp tab="money" step="step 6 of apps/builder/BUILD.md"
    title="Money" lead="Rollups across every project, milestones, contracts and what each one owes." />;
}
