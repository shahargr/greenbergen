import { createClient } from "@/lib/supabase/server";

// What the signed-in person may upload, from their plan (plus overrides).
// The database enforces this in record_project_file(); the UI reads it so
// it only offers what will be accepted - no video button on a plan without
// video.
export type Caps = { image: boolean; video: boolean; voice: boolean; document: boolean; superadmin: boolean };

export async function getCaps(): Promise<Caps> {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  if (!me?.app_user_id) return { image: false, video: false, voice: false, document: false, superadmin: false };
  const { data } = await supabase.rpc("user_entitlement", { p_user: me.app_user_id });
  const e = (Array.isArray(data) ? data[0] : data) as { is_super?: boolean; cap_image?: boolean; cap_video?: boolean; cap_voice?: boolean; cap_document?: boolean } | null;
  const sup = !!e?.is_super || !!me.is_superadmin;
  return {
    image: sup || !!e?.cap_image,
    video: sup || !!e?.cap_video,
    voice: sup || !!e?.cap_voice,
    document: sup || !!e?.cap_document,
    superadmin: sup,
  };
}

// The accept list for a file picker, from the caps.
export function acceptFor(c: Caps): string {
  const parts: string[] = [];
  if (c.image) parts.push("image/*");
  if (c.video) parts.push("video/*");
  if (c.document) parts.push("application/pdf");
  return parts.join(",");
}
export function capsHint(c: Caps): string {
  const allowed = [c.image && "photos", c.video && "video", c.voice && "audio", c.document && "PDFs"].filter(Boolean);
  return allowed.length ? `Your plan allows: ${allowed.join(", ")}.` : "Your plan does not allow uploads.";
}
