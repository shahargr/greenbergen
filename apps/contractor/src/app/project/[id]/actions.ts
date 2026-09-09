"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// Log a site visit.
//
// portal_site_check has been in the database since the check-in flow went in
// and nothing has ever called it. It writes a site_checkins row against your
// own check-in link for the project (portal_my_checkin_token mints one on
// first use) and, on arrival, puts you on the day's roster - leaving does
// not take you off it, because you were there.
//
// Two buttons and an optional note, not a form: on a phone, standing in a
// driveway, the whole interaction has to be one tap. The kind is validated
// in the function, which raises rather than returns for a bad one, so a
// wrong value is a bug and not a message.
export async function siteCheck(projectId: string, kind: "arrive" | "leave", formData: FormData) {
  const note = String(formData.get("note") ?? "").trim() || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_site_check", {
    p_project: projectId, p_kind: kind, p_note: note,
  });
  revalidatePath(`/project/${projectId}`);
  if (error) redirect(`/project/${projectId}?error=${encodeURIComponent(friendly(error.message))}`);
  redirect(`/project/${projectId}?ok=${kind}`);
}
