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
  // Honeypot: a field no person sees or fills. Bots fill everything.
  website2?: string | null;
}) {
  if (input.website2) return { ok: true };
  // The form caps these client-side; the same caps hold here for anyone
  // who skips the form.
  const cap = (v: string | null | undefined, n: number) => {
    const t = (v ?? "").trim().slice(0, n);
    return t || null;
  };
  const name = cap(input.name, 120) ?? "";
  const email = cap(input.email, 200);
  const phone = cap(input.phone, 40);
  const message = cap(input.message, 2000);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("about_inquire", {
    p_project_id: input.projectId,
    p_name: name,
    p_phone: phone,
    p_email: email,
    p_kind: input.kind,
    p_message: message,
    p_preferred_date: input.preferredDate,
  });

  if (error || data !== "ok") {
    const raw = typeof data === "string" && data.startsWith("ERROR: ") ? data.slice(7) : null;
    return { error: raw ?? "Could not send — please try again." };
  }

  // No admin address configured means no notification; the lead is in the
  // task list either way.
  const admin = process.env.MAIL_ADMIN?.trim();
  if (!admin) return { ok: true };
  const origin = (process.env.NEXT_PUBLIC_SITE_ORIGIN?.trim() || "https://greenbergen.vercel.app").replace(/\/$/, "");
  // A buyer and a renter are not "a question", and the subject line is the
  // only part of this that reaches a phone on a Saturday.
  const said: Record<string, string> = {
    site_visit: "site visit", more_info: "details", buy: "BUYER", rent: "RENTER", tour: "viewing",
  };
  await sendMail(
    admin,
    `New lead: ${said[input.kind] ?? "question"} from ${name}`,
    `A new inquiry just arrived and is waiting in your task list.\n\n` +
      `Name: ${name}\n` +
      (phone ? `Phone: ${phone}\n` : "") +
      (email ? `Email: ${email}\n` : "") +
      (input.preferredDate ? `Preferred date: ${input.preferredDate}\n` : "") +
      (message ? `Message: ${message}\n` : "") +
      `\nOpen your dashboard: ${origin}/my?panel=tasks`,
  );

  return { ok: true };
}
