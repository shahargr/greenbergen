"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendMail } from "@/lib/mailer";

// Book a slot: the database (book_deal) holds all the rules - open deal,
// offered date, capacity, one booking per person - and files the dispatch
// task that the (future) booking agent scans. Payment capture is not wired
// to a processor yet, so a booking is a held reservation with the amount
// due on record. Submitting the form counts as the deal's "click".
export async function bookDeal(formData: FormData) {
  const promotionId = String(formData.get("deal") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!promotionId || !date) redirect("/deals?error=" + encodeURIComponent("Pick a date first."));

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent("/deals")}`);

  await supabase.rpc("deal_track", { p_kind: "click", p_ids: [promotionId] });

  const { data, error } = await supabase.rpc("book_deal", {
    p_promotion_id: promotionId,
    p_service_date: date,
  });
  revalidatePath("/deals");
  if (error || !data?.ok) {
    redirect("/deals?error=" + encodeURIComponent(data?.reason ?? error?.message ?? "Could not book."));
  }

  // Confirmation to the customer; a failed email never unwinds the booking.
  const email = auth.user.email;
  if (email) {
    const amount = data.amount_cents != null ? `$${(data.amount_cents / 100).toFixed(2)}` : null;
    try {
      await sendMail(
        email,
        `Booking confirmed — ${data.title} on ${data.date}`,
        [
          `Your spot is booked.`,
          ``,
          `Deal: ${data.title}`,
          `Date: ${data.date}`,
          amount ? `Amount due: ${amount} (online payment is coming; we'll send a payment link before the visit)` : null,
          ``,
          `Need to change it? Manage your booking at https://greenbergen.vercel.app/deals`,
          ``,
          `— Green Bergen`,
        ].filter((l) => l != null).join("\n")
      );
    } catch {
      // Booking stands; the dispatch task carries the customer contact.
    }
  }
  redirect("/deals?booked=" + encodeURIComponent(String(data.date)));
}

export async function cancelBooking(formData: FormData) {
  const promotionId = String(formData.get("deal") ?? "");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent("/deals")}`);
  const { data, error } = await supabase.rpc("cancel_deal_booking", { p_promotion_id: promotionId });
  revalidatePath("/deals");
  if (error || !data?.ok) {
    redirect("/deals?error=" + encodeURIComponent(data?.reason ?? error?.message ?? "Could not cancel."));
  }
  redirect("/deals");
}
