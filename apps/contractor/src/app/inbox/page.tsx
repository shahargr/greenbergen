import { redirect } from "next/navigation";
import { AppBar, Notice, Screen, ShellIcons } from "@shared/ui";
import { InboxScreen } from "@shared/inbox/Inbox";
import { loadInbox, unreadCount } from "@shared/inbox/data";
import { getMe } from "@/lib/me";
import { ExpertTabs } from "@/components/ExpertTabs";
import { loadDoors } from "@shared/doors.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

// The portal's inbox, in this app. Same functions, same rows - one inbox
// seen through four doors, not four inboxes.
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const [me, data, doors] = await Promise.all([getMe(), loadInbox(), loadDoors()]);
  // Already loaded: no reason to ask the database for a number we have.
  const unread = unreadCount(data.messages);
  if (!me.signed_in) redirect("/login?next=/inbox");

  return (
    <Screen>
      <AppBar brand  right={<ShellIcons unread={unread} gearHref="/business" inboxHref="/inbox" />} />
      <div className="body">
        {ok && <div className="banner-ok">{ok}</div>}
        {error && <Notice kind="error">{error}</Notice>}
        {/* An offer message opens the offer, not the project: the project is
            behind the address rule until someone accepts. */}
        <InboxScreen data={data} base="/inbox" offerHref={(id) => `/offer/${id}`} />
      </div>
      <ExpertTabs manages={doors.manages} current="inbox" />
    </Screen>
  );
}
