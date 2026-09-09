import { redirect } from "next/navigation";
import { AppBar, Notice, Screen, ShellIcons } from "@shared/ui";
import { DOORS } from "@shared/doors";
import { InboxScreen } from "@shared/inbox/Inbox";
import { loadInbox, unreadCount } from "@shared/inbox/data";
import { getMe } from "@/lib/me";
import { getBoard } from "@/lib/board";
import { loadDoors } from "@shared/doors.server";
import type { InboxTask } from "@shared/inbox/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

// THE inbox - one page, every door. The portal sends its people here too
// (/my/inbox redirects), because a person has one inbox however many seats
// they hold.
//
// Which door you came through still matters to the chrome: Shahar clicked
// Inbox from Admin and "landed on Home Expert view". So the page takes
// ?door=admin, and when the person does hold the admin door it wears that
// door's name and sends the wordmark and the gear back to the portal. The
// rows, the verbs and the data do not change - only the frame does.
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; door?: string }>;
}) {
  const { ok, error, door } = await searchParams;
  const [me, data, doors, board] = await Promise.all([getMe(), loadInbox(), loadDoors(), getBoard()]);
  // Already loaded: no reason to ask the database for a number we have.
  const unread = unreadCount(data.messages);
  if (!me.signed_in) redirect("/login?next=/inbox");

  const asAdmin = door === "admin" && doors.held.includes("portal");
  const base = asAdmin ? "/inbox?door=admin" : "/inbox";

  // The open tasks that are MINE, as rows in the inbox - the same shape the
  // homeowner inbox draws, so the two doors show one list. The whole board
  // (164 open, 122 on one job) stays on the Tasks screen; the inbox is what
  // needs you, and a task nobody assigned to you does not, yet.
  const contact = board.me?.contact_id ?? null;
  const tasks: InboxTask[] = board.tasks
    .filter((t) => t.state === "open" && contact && t.assignee_id === contact && t.project_id)
    .slice(0, 25)
    .map((t) => ({ id: t.id, action: t.action, status: t.status, target_date: t.target_date,
                   project: t.project, project_id: t.project_id, assignee: t.assignee }));

  return (
    <Screen>
      {asAdmin
        ? <AppBar brand door="portal" home={DOORS.portal.url}
            right={<ShellIcons unread={unread} gearHref={`${DOORS.portal.url}/my/settings`} inboxHref={base} />} />
        : <AppBar brand right={<ShellIcons unread={unread} gearHref="/business" inboxHref="/inbox" homeHref="/work" />} />}
      <div className="body">
        {ok && <div className="banner-ok">{ok}</div>}
        {error && <Notice kind="error">{error}</Notice>}
        {/* An offer message opens the offer, not the project: the project is
            behind the address rule until someone accepts. */}
        <InboxScreen data={data} tasks={tasks} base={base} taskBase="/task"
          projectHref={(id) => `/project/${id}`} offerHref={(id) => `/offer/${id}`} />
      </div>
    </Screen>
  );
}
