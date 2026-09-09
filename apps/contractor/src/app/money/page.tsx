import { redirect } from "next/navigation";
import { getBoard } from "@/lib/board";
import { NextUp } from "@/components/NextUp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money" };

export default async function MoneyPage() {
  const b = await getBoard();
  if (!b.signed_in) redirect("/login?next=/money");
  return <NextUp tab="money" manages step="portal_finance_rollup and portal_projects_overview are already there"
    title="Money" lead="Rollups across every project, milestones, contracts and what each one owes." />;
}
