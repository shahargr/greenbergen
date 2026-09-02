"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const BACK = "/admin/users";

async function admin() {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  if (!me?.is_superadmin) redirect("/my");
  return { supabase, me };
}

function done(error?: string | null) {
  revalidatePath(BACK);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error)}` : `${BACK}?saved=1`);
}

// Contractor requests: approve or reject an applied vendor.
export async function vendorDecision(contactId: string, approve: boolean) {
  const { supabase } = await admin();
  const { data: contact, error } = await supabase
    .from("contacts")
    .update({
      vendor_status: approve ? "approved" : "rejected",
      needs_review: false,
      last_modified_by: "admin:users",
    })
    .eq("id", contactId)
    .select("company_id")
    .maybeSingle();
  if (!error && approve && contact?.company_id) {
    await supabase
      .from("companies")
      .update({ needs_review: false, last_modified_by: "admin:users" })
      .eq("id", contact.company_id);
  }
  done(error?.message);
}

// Suspend / resume an account.
export async function toggleAccount(userId: string, active: boolean) {
  const { supabase, me } = await admin();
  if (userId === me.app_user_id && !active) done("You cannot suspend your own account.");
  const { error } = await supabase
    .from("app_users")
    .update({ is_active: active })
    .eq("id", userId);
  done(error?.message);
}

// Cancel a pending invitation.
export async function cancelInvitation(invitationId: string) {
  const { supabase } = await admin();
  const { error } = await supabase
    .from("app_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("status", "pending");
  done(error?.message);
}

// Seat a user on a project with an app role and an optional authority seat.
export async function assignUser(formData: FormData) {
  const { supabase } = await admin();
  const userId = String(formData.get("user") ?? "");
  const projectId = String(formData.get("project") ?? "");
  const role = String(formData.get("role") ?? "collaborator");
  const projectRole = String(formData.get("project_role") ?? "").trim() || null;
  if (!userId || !projectId) done("Pick a user and a project.");

  const { data: u } = await supabase
    .from("app_users")
    .select("contact_id")
    .eq("id", userId)
    .maybeSingle();

  const { error } = await supabase.from("project_members").insert({
    project_id: projectId,
    app_user_id: userId,
    contact_id: u?.contact_id ?? null,
    role,
    project_role: projectRole,
    status: "active",
  });
  done(error ? (error.message.includes("duplicate") ? "They already hold that seat." : error.message) : null);
}

// Projects: create and rename.
export async function createProjectAdmin(formData: FormData) {
  const { supabase, me } = await admin();
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!name) done("The project needs a name.");
  const { error } = await supabase.from("projects").insert({
    project_name: name,
    address: address || null,
    status: "In Progress",
    domain: "construction",
    owner_user_id: me.app_user_id,
    created_by: "admin:users",
  });
  done(error?.message);
}

export async function renameProject(projectId: string, formData: FormData) {
  const { supabase } = await admin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) done("The project needs a name.");
  const { error } = await supabase
    .from("projects")
    .update({ project_name: name, last_modified_by: "admin:users" })
    .eq("id", projectId);
  done(error?.message);
}

// Contacts & companies: edit details, delete where safe.
export async function saveParty(kind: "contact" | "company", id: string, formData: FormData) {
  const { supabase } = await admin();
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  if (!name) done("A name is required.");

  const { error } =
    kind === "contact"
      ? await supabase
          .from("contacts")
          .update({ name, phone, email_a: email, last_modified_by: "admin:users" })
          .eq("id", id)
      : await supabase
          .from("companies")
          .update({ company_name: name, main_phone: phone, main_email: email, last_modified_by: "admin:users" })
          .eq("id", id);
  done(error?.message);
}

export async function deleteParty(kind: "contact" | "company", id: string) {
  const { supabase } = await admin();
  const { error } = await supabase
    .from(kind === "contact" ? "contacts" : "companies")
    .delete()
    .eq("id", id);
  done(
    error
      ? error.message.includes("violates foreign key")
        ? "In use elsewhere (tasks, trades, projects...) — cannot be deleted safely. Suspend or edit instead."
        : error.message
      : null,
  );
}
