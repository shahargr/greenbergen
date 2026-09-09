import { redirect } from "next/navigation";
import { AppBar, Notice, Screen, ShellIcons } from "@shared/ui";
import { InboxScreen } from "@shared/inbox/Inbox";
import { loadInbox, unreadCount } from "@shared/inbox/data";
import { getMe } from "@/lib/me";
import { getBoard } from "@/lib/board";
import { ExpertTabs } from "@/components/ExpertTabs";
import { loadDoors } from "@shared/doors.server";
import type { InboxTask } from "@shared/inbox/data";

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
  const [me, data, doors, board] = await Promise.all([getMe(), loadInbox(), loadDoors(), getBoard()]);
  // Already loaded: no reason to ask the database for a number we have.
  const unread = unreadCount(data.messages);
  if (!me.signed_in) redirect("/login?next=/inbox");

  // The open tasks that are MINE, as rows in the inbox - the same shape the
  // homeowner inbox draws, so the two doors show one list. The whole board
  // (164 open, 122 on one job) stays on the Tasks tab; the inbox is what
  // needs you, and a task nobody assigned to you does not, yet.
  const contact = board.me?.contact_id ?? null;
  const tasks: InboxTask[] = board.tasks
    .filter((t) => t.state === "open" && contact && t.assignee_id === contact && t.project_id)
    .slice(0, 25)
    .map((t) => ({ id: t.id, action: t.action, status: t.status, target_date: t.target_date,
                   project: t.project, project_id: t.project_id, assignee: t.assignee }));

  return (
    <Screen>
      <AppBar brand  right={<ShellIcons unread={unread} gearHref="/business" inboxHref="/inbox" />} />
      <div className="body">
        {ok && <div className="banner-ok">{ok}</div>}
        {error && <Notice kind="error">{error}</Notice>}
        {/* An offer message opens the offer, not the project: the project is
            behind the address rule until someone accepts. */}
        <InboxScreen data={data} tasks={tasks} base="/inbox" taskBase="/task"
          projectHref={(id) => `/project/${id}`} offerHref={(id) => `/offer/${id}`} />
      </div>
      <ExpertTabs manages={doors.manages} current="inbox" />
    </Screen>
  );
}
