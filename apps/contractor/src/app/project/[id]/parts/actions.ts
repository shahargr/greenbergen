"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// THE TRADE LOGS ITS OWN WORK. Every rule is the database's - which house the
// part hangs on, who may write it, that a product is found rather than made
// twice. This relays and reports.

const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };

export async function savePart(projectId: string, formData: FormData) {
  const here = `/project/${projectId}/parts`;
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_part_save", {
    p: {
      project_id: projectId,
      id: txt(formData.get("id")),
      name: txt(formData.get("name")),
      manufacturer: txt(formData.get("manufacturer")),
      model: txt(formData.get("model")),
      part_number: txt(formData.get("part_number")),
      serial: txt(formData.get("serial")),
      spec_url: txt(formData.get("spec_url")),
      trade: txt(formData.get("trade")),
      room: txt(formData.get("room")),
      where: txt(formData.get("where")),
      installed_on: txt(formData.get("installed_on")),
      installed_by: txt(formData.get("installed_by")),
      warranty_length: txt(formData.get("warranty_length")),
      warranty_start: txt(formData.get("warranty_start")),
      doc_url: txt(formData.get("doc_url")),
      // A checkbox that is off sends nothing, so absence IS false here.
      registered: formData.get("registered") != null,
      transferable: formData.get("transferable") != null,
    },
  });
  if (error) redirect(`${here}?error=${encodeURIComponent(friendly(error.message))}`);
  revalidatePath(here);
  redirect(`${here}?ok=${encodeURIComponent("Saved.")}`);
}

export async function saveWorkmanship(projectId: string, formData: FormData) {
  const here = `/project/${projectId}/parts`;
  const said = String(formData.get("transferable") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_workmanship_save", {
    p: {
      contract_id: txt(formData.get("contract_id")),
      covers: txt(formData.get("covers")),
      months: txt(formData.get("months")),
      claim_contact: txt(formData.get("claim_contact")),
      // THREE ANSWERS. "Nobody has said" is not "no" - the register shows
      // them differently and the database keeps null as null, so an empty
      // radio must arrive as an absent key rather than as false.
      ...(said === "" ? {} : { transferable: said === "yes" }),
    },
  });
  if (error) redirect(`${here}?error=${encodeURIComponent(friendly(error.message))}`);
  revalidatePath(here);
  redirect(`${here}?ok=${encodeURIComponent("Saved.")}`);
}
