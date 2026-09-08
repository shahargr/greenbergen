import { redirect } from "next/navigation";
import { AppBar, Notice, Screen, ShellIcons } from "@shared/ui";
import { InboxScreen } from "@shared/inbox/Inbox";
import { loadInbox } from "@shared/inbox/data";
import { getMe } from "@/lib/me";
import { WorkTabs } from "@/components/WorkTabs";

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
  const [me, data] = await Promise.all([getMe(), loadInbox()]);
  if (!me.signed_in) redirect("/login?next=/inbox");

  return (
    <Screen>
      <AppBar brand door="contractor" right={<ShellIcons gearHref="/business" inboxHref="/inbox" />} />
      <div className="body">
        {ok && <div className="banner-ok">{ok}</div>}
        {error && <Notice kind="error">{error}</Notice>}
        <InboxScreen data={data} base="/inbox" />
      </div>
      <WorkTabs current="inbox" />
    </Screen>
  );
}
