"use server";

import { createClient } from "@/lib/supabase/server";
import { sendMail } from "@/lib/mailer";

// Submits a public inquiry AND notifies the admin inbox. The database write
// is what matters (about_inquire -> project_inquiries -> lead task, v114);
// the email is best-effort and never blocks the lead.
export async function submitInquiry(input: {
  projectId: string;
  name: string;
  phone: string | null;
  email: string | null;
  kind: string;
  message: string | null;
  preferredDate: string | null;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("about_inquire", {
    p_project_id: input.projectId,
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email,
    p_kind: input.kind,
    p_message: input.message,
    p_preferred_date: input.preferredDate,
  });

  if (error || data !== "ok") {
    const raw = typeof data === "string" && data.startsWith("ERROR: ") ? data.slice(7) : null;
    return { error: raw ?? "Could not send — please try again." };
  }

  const admin = process.env.MAIL_ADMIN ?? "shahar.greenberg@gmail.com";
  await sendMail(
    admin,
    `New lead: ${input.kind === "site_visit" ? "site visit" : "question"} from ${input.name}`,
    `A new inquiry just arrived and is waiting in your task list.\n\n` +
      `Name: ${input.name}\n` +
      (input.phone ? `Phone: ${input.phone}\n` : "") +
      (input.email ? `Email: ${input.email}\n` : "") +
      (input.preferredDate ? `Preferred date: ${input.preferredDate}\n` : "") +
      (input.message ? `Message: ${input.message}\n` : "") +
      `\nOpen your dashboard: https://greenbergen.vercel.app/my?panel=tasks`,
  );

  return { ok: true };
}
