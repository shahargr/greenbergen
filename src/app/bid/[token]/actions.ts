"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// THE ONE WRITE A LINK CAN DO: put a price in. The token is the credential
// and bid_reply_by_token is the rule - it refuses a revoked link, a closed
// room and a settled bid, and it records the reply through the same body the
// signed-in door uses, so a price means the same thing whichever way it came.
//
// Nothing here is trusted: the amount is parsed, the note is capped by the
// database, and the ticked lines are read back from the form rather than from
// anything the page was handed.
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };

export async function sendPrice(token: string, formData: FormData) {
  const here = `/bid/${token}`;
  // TWO KINDS OF LINE IN ONE ARRAY. A base line carries whether it is in his
  // price; an OPTION carries a price of its own and nothing else - it is not
  // part of the number, so "included" is meaningless on it and it can never
  // count as a gap.
  const ids = String(formData.get("items") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const optIds = String(formData.get("options") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const lineItems = [
    // A PRICE PER LINE when the room asked for one (188), in price_<id>. A
    // room asking for one lump sum sends nothing and the line stays a plain
    // tick, exactly as it was.
    ...ids.map((id) => ({
      scope_item_id: id,
      included: formData.get(`inc_${id}`) === "on",
      price: num(formData.get(`price_${id}`)),
    })),
    ...optIds.map((id) => ({
      scope_item_id: id,
      included: false,
      price: num(formData.get(`opt_${id}`)),
    })).filter((o) => o.price != null),
  ];

  // THE TOTAL. A per-line room does not make him type it again - the lines
  // ARE the bid, and asking for both is how the two end up disagreeing. He
  // may still write one, and then it is his number that counts.
  const lineSum = lineItems
    .filter((l) => l.included && l.price != null)
    .reduce((n, l) => n + (l.price as number), 0);
  const amount = num(formData.get("amount")) ?? (lineSum > 0 ? lineSum : null);
  if (amount == null) {
    redirect(`${here}?error=${encodeURIComponent(
      lineItems.some((l) => l.included) && ids.length > 0
        ? "Put your price in — either the total, or a price on the lines."
        : "Put your price in first.")}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bid_reply_by_token", {
    p_token: token,
    p_amount: amount,
    p_valid_until: txt(formData.get("valid_until")),
    p_notes: txt(formData.get("notes")),
    p_line_items: lineItems.length > 0 ? lineItems : null,
  });

  revalidatePath(here);
  if (error || !data?.ok) {
    redirect(`${here}?error=${encodeURIComponent(data?.reason ?? "That did not send. Try again in a moment.")}`);
  }
  redirect(`${here}?ok=${data.like_for_like ? "sent" : "gaps"}`);
}
