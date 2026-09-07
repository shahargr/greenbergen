import { notFound, redirect } from "next/navigation";
import { decodeSelections, loadPackage } from "@shared/catalogue";
import { getMe, type TargetWindow } from "@/lib/me";
import { getBooking } from "@/lib/booking";
import { BookingWizard, type WizardMode } from "./BookingWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book" };

// Screens 7-10: which home, address, the home, photos, budget, book.
// ?mode=plan saves it without sending; ?from=<project> posts a saved plan.
// Signed-in only (the package pages before this are public).
export default async function BookPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ sel?: string; mode?: string; from?: string }> }) {
  const { code } = await params;
  const { sel, mode: modeParam, from } = await searchParams;
  const [{ pkg }, me] = await Promise.all([loadPackage(code), getMe()]);
  if (!pkg || pkg.availability !== "priced") notFound();
  const here = `/packages/${code}/book?${new URLSearchParams({ ...(sel ? { sel } : {}), ...(modeParam ? { mode: modeParam } : {}), ...(from ? { from } : {}) }).toString()}`;
  if (!me.signed_in) redirect(`/join?next=${encodeURIComponent(here)}`);

  // Posting a plan: the selections and the home are the plan's own.
  let mode: WizardMode = modeParam === "plan" ? "plan" : "book";
  let planned: { project_id: string; address: string | null; target_window: TargetWindow | null } | null = null;
  let selections = decodeSelections(pkg, sel);
  let knownFacts = (me.home?.facts as Record<string, string | number> | null) ?? null;
  if (from) {
    const { booking } = await getBooking(from);
    if (!booking || booking.state !== "planned" || booking.package_code !== pkg.code) redirect(`/project/${from}`);
    mode = "post";
    planned = { project_id: booking.project_id, address: booking.address, target_window: booking.target_window };
    selections = booking.selections as typeof selections;
    const home = me.homes.find((h) => h.project_id === booking.home_project_id);
    knownFacts = ((booking.facts ?? home?.facts) as Record<string, string | number> | null) ?? null;
  }

  return (
    <BookingWizard
      pkg={pkg}
      selections={selections}
      mode={mode}
      planned={planned}
      homes={me.homes}
      quota={me.home_quota}
      knownAddress={me.home?.address ?? null}
      knownFacts={knownFacts}
      dbReady={!me.missing}
    />
  );
}
