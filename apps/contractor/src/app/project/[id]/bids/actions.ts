"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// THE BID BOARD'S ONE WRITE: open a room on a trade. Everything the room
// does afterwards lives on the room's own screen. portal_bid_room_open owns
// the rule - it refuses a property, it refuses a trade the catalogue does
// not know, it hands back the room that already exists rather than opening
// a second, and it pulls that trade's scope in as the rows of the table.
const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };

export async function openRoom(projectId: string, formData: FormData) {
  const trade = txt(formData.get("trade"));
  const back = `/project/${projectId}/bids`;
  if (!trade) redirect(`${back}?error=${encodeURIComponent("Say which trade.")}`);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_bid_room_open", {
    p_project: projectId,
    p_trade: trade,
    p_reply_by: txt(formData.get("reply_by")),
    p_summary: txt(formData.get("summary")),
  });
  revalidatePath(back);
  revalidatePath(`/project/${projectId}`);
  if (error || !data?.ok) {
    redirect(`${back}?error=${encodeURIComponent(data?.reason ?? friendly(error?.message, "That room did not open."))}`);
  }
  // Straight into the room: the next thing is always adding somebody to it.
  redirect(`/project/${projectId}/bids/${data.id as string}?ok=${data.existed ? "existed" : "opened"}`);
}
