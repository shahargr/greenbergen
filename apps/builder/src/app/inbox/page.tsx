import { redirect } from "next/navigation";
import { AppBar, Notice, Screen, ShellIcons } from "@shared/ui";
import { InboxScreen } from "@shared/inbox/Inbox";
import { loadInbox } from "@shared/inbox/data";
import { getBoard } from "@/lib/me";
import { BuildTabs } from "@/components/BuildTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

// The portal's inbox, in this app. Same functions, same rows - a message
// marked done here is done in the portal and in the other two apps, because
// there is one inbox seen through four doors.
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const [board, data] = await Promise.all([getBoard(), loadInbox()]);
  if (!board.signed_in) redirect("/login?next=/inbox");

  return (
    <Screen>
      <AppBar brand door="builder" right={<ShellIcons gearHref="/settings" inboxHref="/inbox" />} />
      <div className="body">
        {ok && <div className="banner-ok">{ok}</div>}
        {error && <Notice kind="error">{error}</Notice>}
        <InboxScreen data={data} base="/inbox" taskBase="/task" projectHref={(id) => `/project/${id}`} />
      </div>
      <BuildTabs current="inbox" tasks={board.tasks.filter((t) => t.state === "open").length} />
    </Screen>
  );
}
