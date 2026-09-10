import { notFound, redirect } from "next/navigation";
import { decodeSelections, loadPackage } from "@shared/catalogue";
import { getMe, type TargetWindow } from "@/lib/me";
import { getBooking } from "@/lib/booking";
import { BookingWizard, type WizardMode } from "./BookingWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book" };

// Screens 7-10: which home, address, the home, photos, budget, book.
// ?mode=plan saves it without sending; ?from=<project> posts a saved plan.
//
// OPEN TO VISITORS (Shahar, 2026-09-10): a visitor walks the whole wizard -
// address, the house, photos, budget - and is asked to create the account
// only at the last step, inside the wizard, right before the booking is
// written. Posting a saved plan (?from=) is the one branch that needs a
// member, because the plan belongs to one. ?resume=1 is the return leg of
// a Google sign-up: the wizard picks the half-filled booking back up.
export default async function BookPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ sel?: string; mode?: string; from?: string; resume?: string }> }) {
  const { code } = await params;
  const { sel, mode: modeParam, from, resume } = await searchParams;
  const [{ pkg }, me] = await Promise.all([loadPackage(code), getMe()]);
  if (!pkg || pkg.availability !== "priced") notFound();
  const here = `/packages/${code}/book?${new URLSearchParams({ ...(sel ? { sel } : {}), ...(modeParam ? { mode: modeParam } : {}), ...(from ? { from } : {}) }).toString()}`;
  if (from && !me.signed_in) redirect(`/login?next=${encodeURIComponent(here)}`);

  // Posting a plan: the selections and the home are the plan's own.
  let mode: WizardMode = modeParam === "plan" ? "plan" : "book";
  let planned: { project_id: string; address: string | null; target_window: TargetWindow | null } | null = null;
  let selections = decodeSelections(pkg, sel);
  let knownFacts = (me.signed_in ? (me.home?.facts as Record<string, string | number> | null) : null) ?? null;
  if (from && me.signed_in) {
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
      homes={me.signed_in ? me.homes : []}
      quota={me.signed_in ? me.home_quota : null}
      knownAddress={me.signed_in ? me.home?.address ?? null : null}
      knownFacts={knownFacts}
      dbReady={me.signed_in ? !me.missing : true}
      signedIn={me.signed_in}
      here={here}
      resume={resume === "1" && me.signed_in}
    />
  );
}
