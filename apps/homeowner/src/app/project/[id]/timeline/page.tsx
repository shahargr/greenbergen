import { notFound, redirect } from "next/navigation";
import { getBooking, signedUrls } from "@/lib/booking";
import { AppBar, Screen } from "@shared/ui";
import { Timeline } from "./Timeline";
import { markSeen } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Timeline" };

// Screen 14 - the timeline: permanent record between the two parties.
// Either side attaches a photo + text or a voice note at any moment.
export default async function TimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { booking: b, missing, supabase } = await getBooking(id);
  if (missing) redirect("/project");
  if (!b) notFound();
  if (b.unread > 0) await markSeen(id);
  const urls = await signedUrls(supabase, b.messages.map((m) => m.file?.path ?? "").filter(Boolean));
  const other = b.is_owner ? b.contractor?.person?.split(" ")[0] ?? null : b.owner?.name?.split(" ")[0] ?? "the homeowner";
  return (
    <Screen>
      <AppBar back={`/project/${id}`} title="Timeline" sub={other ? `Permanent record · you and ${other}` : "Permanent record"} />
      <Timeline projectId={id} messages={b.messages} urls={urls} counterpart={other} canSend={!!(b.is_owner ? b.contractor : b.owner)} />
    </Screen>
  );
}
