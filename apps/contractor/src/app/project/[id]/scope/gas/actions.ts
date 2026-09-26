"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// One appliance, one save. The database decides everything that matters -
// who may answer, which house the answer belongs to, and that an appliance
// answered "not there" cannot also carry a model number.
export async function saveAppliance(projectId: string, formData: FormData) {
  const txt = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : v;
  };
  const here = `/project/${projectId}/scope/gas`;

  // THREE ANSWERS, and the empty one is a real answer to give back: somebody
  // who opened the wrong appliance can put it back to unanswered rather than
  // being forced into a yes or a no they do not have.
  const said = String(formData.get("present") ?? "");
  const present = said === "yes" ? true : said === "no" ? false : null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_gas_appliance_save", {
    p: {
      project_id: projectId,
      kind: String(formData.get("kind") ?? ""),
      present,
      manufacturer: txt("manufacturer"),
      model: txt("model"),
      // People write "100,000" and "100k". Strip everything that is not a
      // digit rather than refusing the number they meant.
      input_btuh: (() => {
        const raw = txt("input_btuh");
        if (!raw) return null;
        const k = /k\s*$/i.test(raw);
        const n = Number(raw.replace(/[^0-9.]/g, ""));
        if (!Number.isFinite(n) || n <= 0) return null;
        return String(k ? n * 1000 : n);
      })(),
      fuel: txt("fuel"),
      location: txt("location"),
      note: txt("note"),
    },
  });

  if (error) redirect(`${here}?error=${encodeURIComponent(friendly(error.message))}`);
  revalidatePath(here);
  redirect(`${here}?ok=${encodeURIComponent("Saved.")}`);
}
