import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { decodeSelections, findPackage, loadCatalogue } from "@shared/catalogue";
import { getMe } from "@/lib/me";
import { BookingWizard } from "./BookingWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book" };

// Screens 7-10: address, the home, photos, budget, book. Signed-in only
// (the package pages before this are public).
export default async function BookPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ sel?: string }> }) {
  const { code } = await params;
  const { sel } = await searchParams;
  const supabase = await createClient();
  const [{ packages }, me] = await Promise.all([loadCatalogue(supabase), getMe()]);
  const pkg = findPackage(packages, code);
  if (!pkg || pkg.availability !== "priced") notFound();
  if (!me.signed_in) redirect(`/join?next=${encodeURIComponent(`/packages/${code}/book${sel ? `?sel=${encodeURIComponent(sel)}` : ""}`)}`);
  const selections = decodeSelections(pkg, sel);
  return (
    <BookingWizard
      pkg={pkg}
      selections={selections}
      knownAddress={me.home?.address ?? null}
      knownFacts={(me.home?.facts as Record<string, string | number> | null) ?? null}
      dbReady={!me.missing}
    />
  );
}
