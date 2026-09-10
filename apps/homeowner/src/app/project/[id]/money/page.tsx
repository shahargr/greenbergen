import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { loadFinancials } from "@shared/finance/data";
import { FinancialsScreen } from "@shared/finance/FinancialsScreen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money" };

// The homeowner's side of the money: what was agreed, what they paid, what
// is still owed, and the changes a contractor asked for. The same screen
// the Professionals app shows the contractor; the database decides which
// side of it each person is on.
export default async function MoneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  if (!(await isSignedIn(supabase))) redirect(`/login?next=${encodeURIComponent(`/project/${id}/money`)}`);
  const { fin, urls } = await loadFinancials(supabase, id);
  return <FinancialsScreen fin={fin} urls={urls} back={`/project/${id}`} />;
}
