import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { loadFinancials } from "@shared/finance/data";
import { FinancialsScreen } from "@shared/finance/FinancialsScreen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money" };

// The contractor's side - request a payment, ask for a change, confirm the
// money landed - and, for whoever runs the site, the payor's: the schedule,
// approvals, recording what was paid. One screen, shared with the
// homeowner app; project_financials decides which side you are on.
export default async function MoneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  if (!(await isSignedIn(supabase))) redirect(`/login?next=${encodeURIComponent(`/project/${id}/money`)}`);
  const { fin, urls } = await loadFinancials(supabase, id);
  return <FinancialsScreen fin={fin} urls={urls} back={`/project/${id}`} />;
}
