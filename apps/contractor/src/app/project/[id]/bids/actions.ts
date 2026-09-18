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

// A TRADE OFF THE BOARD (migration 188d). Shahar (2026-09-18): "where bill
// negotiator was created, as well as handy man. need to have a way to delete
// them from this screen if i have the right permissions."
//
// The board's trade list is project_bid_needs, and things land in it by hand
// and by blueprint. "Handy man" is not a trade the catalogue even knows -
// somebody typed it - and it has sat in NOT STARTED ever since, asking to be
// acted on forever. portal_bid_trade_drop owns the rule: it takes every row
// for that trade across the family and an empty room with it, and refuses
// when anybody has bid or a contract names the trade, because that is not a
// tidy-up, that is deleting the record of work.
export async function dropTrade(projectId: string, formData: FormData) {
  const trade = txt(formData.get("trade"));
  const back = `/project/${projectId}/bids`;
  if (!trade) redirect(`${back}?error=${encodeURIComponent("Say which trade.")}`);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_bid_trade_drop", { p_project: projectId, p_trade: trade });
  revalidatePath(back);
  revalidatePath(`/project/${projectId}`);
  if (error || !data?.ok) {
    redirect(`${back}?error=${encodeURIComponent(data?.reason ?? friendly(error?.message, "That did not come off."))}`);
  }
  redirect(`${back}?ok=dropped&who=${encodeURIComponent(trade)}`);
}
