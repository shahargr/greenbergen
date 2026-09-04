import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { ProjectEditor } from "./ProjectEditor";
import { projectPerms, updateContact } from "./actions";
import { inviteToProject } from "../../invite/actions";
import { TasksTable, type TableTask } from "../../TasksTable";
import { ConfiguratorForm, GENERATOR_FIELDS } from "./ConfiguratorForm";
import { ConfigChecklist, type ConfigItem } from "./ConfigChecklist";
import { ProjectBrief } from "@/components/ProjectBrief";
import { AddTaskForm } from "../../AddTaskForm";

export const dynamic = "force-dynamic";

type MemberRow = {
  role: string;
  project_role: string | null;
  contact_id: string | null;
  contacts: { name: string; person_name?: string | null; phone?: string | null; email_a?: string | null; avatar_path?: string | null } | null;
};

// Project drill-down: details (unlock-to-edit per rank), the people on it,
// its files - voice notes play right here - and its tasks.
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; ok?: string; error?: string; tasks?: string; assign?: string; parent?: string; people?: string; day?: string }>;
}) {
  const { id } = await params;
  const { saved, ok: flashOk, error, tasks: tasksBucket, assign: assignContact, parent: parentTask, people: peopleMode, day: dayParam } = await searchParams;
  // A day picked on the week calendar (?day=YYYY-MM-DD) opens its table.
  const selectedDay = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null;
  const showAllPeople = peopleMode === "all";
  // ?tasks=open|done|stuck pre-filters the task list (the homepage card's
  // three counts link here).
  const initialTaskState: "open" | "closed" | "all" = tasksBucket === "done" ? "closed" : "open";
  // Default on load: the 10 most urgent tasks. ?tasks=open|done|stuck override.
  const initialTaskView: "all" | "stuck" | "urgent" =
    parentTask ? "all" : tasksBucket === "stuck" ? "stuck" : (tasksBucket === "done" || tasksBucket === "open") ? "all" : "urgent";
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_name, status, address, notes, parent_project_id, owner_user_id, created_at, purchase_date, purchase_amount, sold_date, sold_amount")
    .eq("id", id)
    .maybeSingle();

  if (!project) {
    return (
      <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}>
        <p className="muted">This project does not exist — or is not yours to see.</p>
        <p><Link href="/my?panel=projects">← Back to your projects</Link></p>
      </main>
    );
  }

  const [perms, { data: memberRows }, { data: taskData }, { data: configRows }, { data: configValueRows }] =
    await Promise.all([
      projectPerms(id),
      supabase
        .from("project_members")
        .select("role, project_role, contact_id, contacts(name, person_name, phone, email_a, avatar_path)")
        .eq("project_id", id)
        .eq("status", "active"),
      supabase.rpc("portal_tasks", { p_project_id: id, p_open_limit: 200, p_closed_limit: 200 }),
      supabase
        .from("actions")
        .select("id, action, status, requires_photo_evidence, notes")
        .eq("project_id", id)
        .eq("scope_milestone", "Configuration")
        .order("created_at"),
      supabase
        .from("project_config_values")
        .select("key, value")
        .eq("project_id", id),
    ]);

  // Stage (budget-phase) tiles are hidden on this page for now; the task
  // table opens on the 10 most urgent tasks and the late-by-person panels.

  // One line per person - a contact can hold several seats.
  const people = new Map<string, string[]>();
  for (const m of (memberRows ?? []) as unknown as MemberRow[]) {
    const name = m.contacts?.name;
    if (!name) continue;
    const seat = m.project_role ?? m.role;
    const seats = people.get(name) ?? [];
    if (!seats.includes(seat)) seats.push(seat);
    people.set(name, seats);
  }
  // Assignees for the add-task form on this project.
  const taskMembers = (((memberRows ?? []) as unknown as { contact_id: string | null; contacts: { name: string | null; person_name: string | null } | null }[]))
    .filter((m) => m.contact_id && m.contacts)
    .map((m) => ({ projectId: id, contactId: m.contact_id as string, name: m.contacts!.person_name ?? m.contacts!.name ?? "Unnamed", canPay: false }))
    .filter((m, i, arr) => arr.findIndex((x) => x.contactId === m.contactId) === i)
    .sort((a, b) => a.name.localeCompare(b.name));

  type PortalTask = {
    id: string; action: string; status: string; priority: string | null;
    target_date: string | null; last_updated: string | null; notes: string | null;
    project: string | null; domain: string | null; state: "open" | "closed";
    assignee_id: string | null; assignee: string | null; trade: string | null;
    parent_id: string | null; parent_title: string | null; open_children: number;
  };
  const { data: meRow } = await supabase.rpc("me");
  const myContactId: string | null = meRow?.contact_id ?? null;
  // God mode banner: the admin toggle is on, or a superadmin is on a project
  // they hold no seat on. RLS already grants full access; this only makes it
  // visible on the page.
  const godOn = (await cookies()).get("gb_god")?.value === "1";
  const godMode = !!meRow?.is_superadmin && (godOn ||
    !(((memberRows ?? []) as unknown as MemberRow[]).some((m) => !!m.contact_id && m.contact_id === myContactId)));
  const projectTasks: TableTask[] = (((taskData ?? []) as PortalTask[])).map((t) => ({
    id: t.id, action: t.action, status: t.status, priority: t.priority,
    target_date: t.target_date, last_updated: t.last_updated, notes: t.notes,
    project: t.project,
    who: (myContactId && t.assignee_id === myContactId ? "you" : "others") as "you" | "others",
    domain: t.domain,
    state: t.state, trade: t.trade, assignee: t.assignee,
    parent_id: t.parent_id, parent: t.parent_title, open_children: t.open_children,
  }));
  const openCount = projectTasks.filter((t) => t.state === "open").length;
  const doneCount = projectTasks.filter((t) => t.state === "closed").length;

  // Late-by-person panels now live inside TasksTable (clickable filters).
  const todayIso = new Date().toISOString().slice(0, 10);

  // Bid planner: this project's packages, and any bids the caller was invited to.
  const [{ data: bidPkgData }, { data: myBidData }] = await Promise.all([
    supabase.rpc("portal_bid_packages", { p_project: id }),
    supabase.rpc("portal_my_bids", { p_project: id }),
  ]);
  type BidPkg = { id: string; phase: string | null; category: string | null; trade: string | null; status: string; reply_by: string | null; n_invited: number; n_received: number };
  type MyBid = { id: string; package_id: string; phase: string | null; category: string | null; status: string; reply_by: string | null; amount: number | null; package_status: string };
  const bidPkgs = ((bidPkgData ?? []) as BidPkg[]);
  const myBids = ((myBidData ?? []) as MyBid[]);
  // Awarded bids on this project, for the Award stage of the ladder.
  const { data: wonRows } = perms.rank >= 50
    ? await supabase.from("bids").select("id, package_id, amount, contacts(name, person_name)").eq("project_id", id).eq("won", true)
    : { data: [] };
  type WonBid = { id: string; package_id: string | null; amount: number | null; contacts: { name: string | null; person_name: string | null } | null };
  const wonBids = ((wonRows ?? []) as unknown as WonBid[]);
  const wonByPkg = new Map(wonBids.filter((w) => w.package_id).map((w) => [w.package_id as string, w]));
  const totalInvited = bidPkgs.reduce((s, p) => s + (p.n_invited ?? 0), 0);
  const totalReceived = bidPkgs.reduce((s, p) => s + (p.n_received ?? 0), 0);

  // People table: trade, open tasks, outstanding balance, a call link, a
  // create-task link — and, on click, every task the person is connected to.
  const OPEN_TX = ["scheduled", "forecast", "invoice received", "approved", "disputed"];
  const PAID_TX = ["paid", "paid - receipt filed", "paid - pending confirmation", "settled"];
  const memberList = ((memberRows ?? []) as unknown as MemberRow[]);
  const peopleIds = [...new Set(memberList.map((m) => m.contact_id).filter((x): x is string => !!x))];
  const [{ data: personTradeRows }, { data: personTxRows }] = await Promise.all([
    peopleIds.length
      ? supabase.from("contact_trade_roles").select("contact_id, trade").in("contact_id", peopleIds)
      : Promise.resolve({ data: [] as { contact_id: string; trade: string }[] }),
    peopleIds.length
      ? supabase.from("transactions").select("contractor_id, amount, status")
          .eq("project_id", id).eq("direction", "out").in("contractor_id", peopleIds)
      : Promise.resolve({ data: [] as { contractor_id: string; amount: number | null; status: string }[] }),
  ]);
  const personTrade = new Map<string, string>();
  for (const r of (personTradeRows ?? []) as { contact_id: string; trade: string }[]) {
    if (!personTrade.has(r.contact_id)) personTrade.set(r.contact_id, r.trade);
  }
  // "Owed" = scheduled / invoiced / approved but not yet paid to this person;
  // "Paid" = what has actually gone out to them on this project.
  const owed = new Map<string, number>();
  const paidTo = new Map<string, number>();
  for (const r of (personTxRows ?? []) as { contractor_id: string; amount: number | null; status: string }[]) {
    const amt = Number(r.amount ?? 0);
    if (OPEN_TX.includes(r.status)) owed.set(r.contractor_id, (owed.get(r.contractor_id) ?? 0) + amt);
    else if (PAID_TX.includes(r.status)) paidTo.set(r.contractor_id, (paidTo.get(r.contractor_id) ?? 0) + amt);
  }
  const allPortal = ((taskData ?? []) as PortalTask[]);
  type PersonTask = { id: string; action: string; state: "open" | "closed"; target_date: string | null; status: string };
  type PersonRow = { contactId: string; name: string; phone: string | null; email: string | null; trade: string | null; open: number; balance: number; paid: number; tasks: PersonTask[] };
  const peopleRows: PersonRow[] = [];
  const seenPerson = new Set<string>();
  for (const m of memberList) {
    if (!m.contact_id || !m.contacts || seenPerson.has(m.contact_id)) continue;
    seenPerson.add(m.contact_id);
    const mine = allPortal
      .filter((t) => t.assignee_id === m.contact_id)
      .sort((a, b) => (a.state === b.state
        ? (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999")
        : a.state === "open" ? -1 : 1));
    peopleRows.push({
      contactId: m.contact_id,
      name: m.contacts.person_name ?? m.contacts.name,
      phone: m.contacts.phone ?? null,
      email: m.contacts.email_a ?? null,
      trade: personTrade.get(m.contact_id) ?? null,
      open: mine.filter((t) => t.state === "open").length,
      balance: owed.get(m.contact_id) ?? 0,
      paid: paidTo.get(m.contact_id) ?? 0,
      tasks: mine.map((t) => ({ id: t.id, action: t.action, state: t.state, target_date: t.target_date, status: t.status })),
    });
  }
  peopleRows.sort((a, b) => (a.trade ?? "zz").localeCompare(b.trade ?? "zz") || a.name.localeCompare(b.name));

  // Avatars for the late-by-person panels, keyed by the display name the task
  // table uses (person_name, else name). Public bucket, so plain URLs; people
  // without a photo keep the icon.
  const avatars: Record<string, string> = {};
  for (const m of memberList) {
    const ap = m.contacts?.avatar_path;
    if (!m.contacts || !ap) continue;
    const nm = m.contacts.person_name ?? m.contacts.name;
    // ?v= busts the browser cache after a photo is replaced (stable path).
    if (nm && !avatars[nm]) avatars[nm] = `${supabase.storage.from("public-media").getPublicUrl(ap).data.publicUrl}?v=${Date.now()}`;
  }

  type ConfigRow = { id: string; action: string; status: string; requires_photo_evidence: boolean | null; notes: string | null };
  const config = ((configRows ?? []) as ConfigRow[]);
  const configDone = config.filter((c) => ["Completed"].includes(c.status)).length;

  const configIds = config.map((c) => c.id);
  const { data: cfgFileRows } = configIds.length
    ? await supabase
        .from("file_links")
        .select("action_id, files(bucket, path)")
        .in("action_id", configIds)
        .in("role", ["reference", "after", "evidence"])
    : { data: [] };
  const cfgPhotos = new Map<string, string[]>();
  await Promise.all(
    (((cfgFileRows ?? []) as unknown as { action_id: string; files: { bucket: string; path: string } | null }[]))
      .filter((r) => r.files)
      .map(async (r) => {
        const { data } = await supabase.storage.from(r.files!.bucket).createSignedUrl(r.files!.path, 3600);
        if (data?.signedUrl) cfgPhotos.set(r.action_id, [...(cfgPhotos.get(r.action_id) ?? []), data.signedUrl]);
      })
  );
  const configItems: ConfigItem[] = config.map((c) => ({
    id: c.id,
    label: c.action,
    requiresPhoto: !!c.requires_photo_evidence,
    done: c.status === "Completed",
    photos: cfgPhotos.get(c.id) ?? [],
  }));
  // Projects under this one: the delete guard refuses while any exist, so
  // name them with links instead of leaving the user to hunt.
  const { data: childProjectRows } = await supabase
    .from("projects")
    .select("id, project_name, status")
    .eq("parent_project_id", id)
    .is("trashed_at", null)
    .eq("is_template", false)
    .order("project_name");
  const childProjects = ((childProjectRows ?? []) as { id: string; project_name: string; status: string }[]);

  // Hierarchy for the Details card: owner › every parent › this project.
  // Parents are walked upward (a home is normally one level; a portfolio
  // root two), capped so a bad self-reference can never loop.
  const ancestors: { id: string; project_name: string }[] = [];
  let cursor: string | null = (project as { parent_project_id: string | null }).parent_project_id;
  for (let i = 0; cursor && i < 6; i += 1) {
    const { data: up } = await supabase.from("projects").select("id, project_name, parent_project_id").eq("id", cursor).maybeSingle();
    if (!up) break;
    ancestors.unshift({ id: up.id, project_name: up.project_name });
    cursor = up.parent_project_id as string | null;
  }
  const ownerId = (project as { owner_user_id: string | null }).owner_user_id;
  const { data: ownerRow } = ownerId
    ? await supabase.from("app_users").select("full_name, email").eq("id", ownerId).maybeSingle()
    : { data: null as { full_name: string | null; email: string | null } | null };
  const crumbs = [
    ...(ownerRow ? [{ id: "owner", name: ownerRow.full_name ?? ownerRow.email ?? "Owner", href: null as string | null }] : []),
    ...ancestors.map((a) => ({ id: a.id, name: a.project_name, href: `/my/project/${a.id}` as string | null })),
    { id: project.id, name: project.project_name, href: null as string | null },
  ];

  const configValues: Record<string, string> = {};
  for (const r of (configValueRows ?? []) as { key: string; value: string | null }[]) {
    if (r.value != null) configValues[r.key] = r.value;
  }

  // People: most open work first; the idle ones fold away unless asked for.
  const sortedPeople = [...peopleRows].sort((a, b) => (b.open - a.open) || a.name.localeCompare(b.name));
  const activePeople = sortedPeople.filter((p) => p.open > 0);
  const visiblePeople = showAllPeople || activePeople.length === 0 ? sortedPeople : activePeople;

  // This week, Monday to Sunday, in the server's calendar.
  const dayMs = 86400000;
  const todayDate = new Date(todayIso + "T12:00:00");
  const dow = (todayDate.getDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(todayDate.getTime() - dow * dayMs);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * dayMs);
    return d.toISOString().slice(0, 10);
  });
  const weekEndIso = weekDays[6];
  const { data: weekTxRows } = await supabase
    .from("transactions").select("id, description, amount, paid_on, target_date, status")
    .eq("project_id", id).eq("direction", "out")
    .in("status", ["scheduled", "forecast", "approved", "invoice received"])
    .or(`paid_on.gte.${weekDays[0]},target_date.gte.${weekDays[0]}`)
    .limit(100);
  type WeekTx = { id: string; description: string | null; amount: number | null; paid_on: string | null; target_date: string | null; status: string };
  const weekPayments = ((weekTxRows ?? []) as WeekTx[])
    .map((t) => ({ ...t, on: t.paid_on ?? t.target_date }))
    .filter((t) => t.on && t.on >= weekDays[0] && t.on <= weekEndIso);
  const weekTasks = projectTasks.filter((t) => t.state === "open" && t.target_date && t.target_date >= weekDays[0] && t.target_date <= weekEndIso);
  // Completed this week (on the day they closed) and every gate on the
  // project (on its due day): both belong on the calendar.
  type WeekExtra = { id: string; action: string | null; status: string; is_gate: boolean | null; target_date: string | null; completed_on: string | null };
  const { data: extraRows } = await supabase
    .from("actions").select("id, action, status, is_gate, target_date, completed_on")
    .eq("project_id", id)
    .or(`is_gate.eq.true,and(status.eq.Completed,completed_on.gte.${weekDays[0]},completed_on.lte.${weekEndIso})`)
    .limit(200);
  const extras = ((extraRows ?? []) as WeekExtra[]);
  const doneThisWeek = extras
    .filter((a) => a.status === "Completed" && !a.is_gate && a.completed_on && a.completed_on >= weekDays[0] && a.completed_on <= weekEndIso)
    .map((a) => ({ ...a, on: a.completed_on as string }));
  const weekGates = extras
    .filter((a) => a.is_gate)
    .map((a) => ({ ...a, on: (a.status === "Completed" ? (a.completed_on ?? a.target_date) : a.target_date) ?? null, closed: ["Completed", "Cancelled", "Force Cancelled"].includes(a.status) }))
    .filter((a) => a.on && a.on >= weekDays[0] && a.on <= weekEndIso);
  const gateIcon = (closed: boolean) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={closed ? "#1f6b45" : "#c0262d"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ verticalAlign: "-2px", marginRight: 3 }}>
      <path d="M3 21V7M21 21V7" /><path d="M3 9h18M3 13h18M3 17h18" /><path d="M8 7v14M12 7v14M16 7v14" />
    </svg>
  );
  const overdueTasks = projectTasks.filter((t) => t.state === "open" && t.target_date && t.target_date < todayIso);
  const todayTasks = weekTasks.filter((t) => t.target_date === todayIso);
  const restOfWeekTasks = weekTasks.filter((t) => t.target_date! > todayIso).sort((a, b) => a.target_date!.localeCompare(b.target_date!));
  const dayLabel = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  const money = (n: number | null) => (n == null ? "" : `$${Math.round(n).toLocaleString()}`);

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 640 }}>
      <p className="small" style={{ margin: "0 0 6px" }}>
        <Link href="/my">← Your projects</Link>
      </p>
      {godMode && (
        <p className="banner" style={{ background: "#7a1f2b", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span>⚡ <strong>God mode</strong> — you hold no seat on this project; you&apos;re acting with full admin rights.</span>
          <Link href="/admin/projects" style={{ color: "#fff", whiteSpace: "nowrap" }}>All projects →</Link>
        </p>
      )}
      <span className="kicker">{project.parent_project_id ? "Job" : "Home"}</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 2px" }}>{project.project_name}</h1>

      {saved && <p className="banner" style={{ background: "#2f6b4f" }}>Saved ✓</p>}
      {flashOk && <p className="banner" style={{ background: "#2f6b4f" }}>{flashOk}</p>}
      {error && <p className="error small">{error}</p>}
      {childProjects.length > 0 && (
        <p className="small" style={{ margin: "0 0 10px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
          <span className="muted">Under this project:</span>
          {childProjects.map((cp) => (
            <Link key={cp.id} href={`/my/project/${cp.id}`} className="extra-chip" style={{ textDecoration: "none" }}>
              ↳ {cp.project_name} <span className="muted">· {cp.status}</span>
            </Link>
          ))}
        </p>
      )}

      <div style={{ display: "grid", gap: 14, marginTop: 10 }}>
        <ProjectEditor
          project={{ id: project.id, project_name: project.project_name, status: project.status, address: project.address, notes: project.notes }}
          perms={perms}
          crumbs={crumbs}
        />

        {/* The landing view: what is planned this week, day by day, then
            today's list and the rest of the week. */}
        <div className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>This week · {weekTasks.length} task{weekTasks.length === 1 ? "" : "s"}{weekPayments.length ? ` · ${weekPayments.length} payment${weekPayments.length === 1 ? "" : "s"}` : ""}</h2>
            <span className="muted small">{dayLabel(weekDays[0])} – {dayLabel(weekDays[6])}</span>
          </div>
          <div className="weekgrid">
            {weekDays.map((d) => {
              const isToday = d === todayIso;
              const dayTasks = weekTasks.filter((t) => t.target_date === d && !weekGates.some((g) => g.id === t.id));
              const dayPay = weekPayments.filter((t) => t.on === d);
              const dayGates = weekGates.filter((g) => g.on === d);
              const dayDone = doneThisWeek.filter((a) => a.on === d);
              return (
                <div key={d} className={`weekday${isToday ? " today" : ""}${selectedDay === d ? " selected" : ""}`}>
                  <Link href={selectedDay === d ? `/my/project/${project.id}` : `/my/project/${project.id}?day=${d}`} className="weekday-head"
                    style={{ textDecoration: "none", color: "inherit", cursor: "pointer" }} title={selectedDay === d ? "Close this day" : "Show this day's list"}>
                    {dayLabel(d)}{isToday ? " · today" : ""}
                  </Link>
                  {dayTasks.length === 0 && dayPay.length === 0 && dayGates.length === 0 && dayDone.length === 0 && <div className="muted" style={{ fontSize: 11 }}>—</div>}
                  {dayGates.map((g) => (
                    <Link key={g.id} href={`/my/task/${g.id}`} className={`weekitem gate ${g.closed ? "done" : "open"}`} title={`Gate · ${g.status} · ${g.action ?? ""}`}>
                      {gateIcon(g.closed)}{g.action ?? "(gate)"}
                    </Link>
                  ))}
                  {dayTasks.map((t) => (
                    <Link key={t.id} href={`/my/task/${t.id}`} className="weekitem" title={t.action}>
                      {t.priority === "High" && <span style={{ color: "#c0262d" }}>● </span>}{t.action}
                    </Link>
                  ))}
                  {dayDone.map((a) => (
                    <Link key={a.id} href={`/my/task/${a.id}`} className="weekitem done" title={`Completed · ${a.action ?? ""}`}>
                      ✓ {a.action ?? "(untitled)"}
                    </Link>
                  ))}
                  {dayPay.map((p) => (
                    <span key={p.id} className="weekitem pay" title={p.description ?? "payment"}>💵 {money(p.amount)} {p.description ?? ""}</span>
                  ))}
                </div>
              );
            })}
          </div>
          {overdueTasks.length > 0 && (
            <p className="small" style={{ margin: 0, color: "#c0262d" }}>
              {overdueTasks.length} overdue from before this week — <Link href={`/my/project/${project.id}?tasks=stuck`} style={{ color: "inherit" }}>see them</Link>
            </p>
          )}
        </div>

        {/* The picked day, as a table: everything on the calendar for it. */}
        {selectedDay && (() => {
          type DayRow = { id: string; kind: "gate" | "task" | "done" | "payment"; title: string; priority: string | null; who: string | null; status: string; href: string | null };
          const rows: DayRow[] = [
            ...weekGates.filter((g) => g.on === selectedDay).map((g): DayRow => ({ id: g.id, kind: "gate", title: g.action ?? "(gate)", priority: null, who: null, status: g.status, href: `/my/task/${g.id}` })),
            ...weekTasks.filter((t) => t.target_date === selectedDay && !weekGates.some((g) => g.id === t.id)).map((t): DayRow => ({ id: t.id, kind: "task", title: t.action, priority: t.priority, who: t.assignee, status: t.status, href: `/my/task/${t.id}` })),
            ...doneThisWeek.filter((a) => a.on === selectedDay).map((a): DayRow => ({ id: a.id, kind: "done", title: a.action ?? "(untitled)", priority: null, who: null, status: "Completed", href: `/my/task/${a.id}` })),
            ...weekPayments.filter((p) => p.on === selectedDay).map((p): DayRow => ({ id: p.id, kind: "payment", title: `${money(p.amount)} ${p.description ?? ""}`.trim(), priority: null, who: null, status: p.status, href: null })),
          ];
          const kindLabel = { gate: "Gate", task: "Task", done: "Completed", payment: "Payment" } as const;
          const kindStyle = (k: DayRow["kind"], st: string): React.CSSProperties =>
            k === "gate" ? (["Completed", "Cancelled", "Force Cancelled"].includes(st) ? { background: "#e6f2ea", color: "#1f6b45" } : { background: "#fdecec", color: "#c0262d" })
            : k === "done" ? { background: "#e6f2ea", color: "#1f6b45" }
            : k === "payment" ? { background: "#fdf4e3", color: "#a8842c" }
            : { background: "#f0f1ee", color: "#555" };
          return (
            <div className="card" style={{ display: "grid", gap: 6, minWidth: 0, overflowX: "auto", borderLeft: "3px solid var(--brand)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <h2 className="section-title" style={{ margin: 0 }}>
                  {new Date(selectedDay + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} · {rows.length} item{rows.length === 1 ? "" : "s"}
                </h2>
                <Link href={`/my/project/${project.id}`} className="small">Close ✕</Link>
              </div>
              {rows.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing on the calendar for this day.</p>}
              {rows.length > 0 && (
                <table className="tasktable" style={{ width: "100%" }}>
                  <thead><tr><th>Item</th><th>Type</th><th>Priority</th><th>Assigned to</th><th>Status</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.kind}-${r.id}`}>
                        <td style={{ fontWeight: 600 }}>{r.href ? <Link href={r.href}>{r.title}</Link> : r.title}</td>
                        <td><span className="extra-chip" style={kindStyle(r.kind, r.status)}>{r.kind === "gate" ? <>{gateIcon(["Completed", "Cancelled", "Force Cancelled"].includes(r.status))}Gate</> : kindLabel[r.kind]}</span></td>
                        <td className="small">{r.priority === "High" ? <span style={{ color: "#c0262d", fontWeight: 600 }}>High</span> : (r.priority ?? <span className="muted">—</span>)}</td>
                        <td className="small">{r.who ?? <span className="muted">—</span>}</td>
                        <td className="muted small" style={{ whiteSpace: "nowrap" }}>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })()}

        <div className="card" style={{ display: "grid", gap: 6, minWidth: 0 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Today · {todayTasks.length}</h2>
          {todayTasks.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing due today.</p>}
          {todayTasks.map((t) => (
            <Link key={t.id} href={`/my/task/${t.id}`} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, textDecoration: "none", color: "inherit", borderTop: "1px solid #f0f1ee", paddingTop: 6, minWidth: 0 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{t.priority === "High" && <span style={{ color: "#c0262d" }}>● </span>}{t.action}</span>
              <span className="muted" style={{ whiteSpace: "nowrap" }}>{t.assignee ?? "unassigned"}</span>
            </Link>
          ))}
          <h2 className="section-title" style={{ margin: "8px 0 0" }}>Rest of this week · {restOfWeekTasks.length}</h2>
          {restOfWeekTasks.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing else due this week.</p>}
          {restOfWeekTasks.map((t) => (
            <Link key={t.id} href={`/my/task/${t.id}`} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, textDecoration: "none", color: "inherit", borderTop: "1px solid #f0f1ee", paddingTop: 6, minWidth: 0 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{t.priority === "High" && <span style={{ color: "#c0262d" }}>● </span>}{t.action}</span>
              <span className="muted" style={{ whiteSpace: "nowrap" }}>{dayLabel(t.target_date!)}{t.assignee ? ` · ${t.assignee}` : ""}</span>
            </Link>
          ))}
        </div>

        {/* What the owner asked for: description, specs, photos. Travels
            with every bid package as the scope bidders price from. */}
        {project.parent_project_id && <ProjectBrief projectId={project.id} collapsible />}

        {/* On a job the brief carries the specs; the configurator folds away
            underneath it and is only opened to change them. */}
        {config.length > 0 && (
          <details className="card" style={{ display: "grid", gap: 8 }} open={!project.parent_project_id}>
            <summary className="section-title" style={{ margin: 0, cursor: "pointer", listStyle: "revert" }}>
              Configuration · {configDone} of {config.length} done
              <span className="muted small" style={{ fontWeight: 400, marginLeft: 8 }}>edit parameters and the setup checklist</span>
            </summary>
            <div className="progressbar" style={{ marginTop: 8 }}>
              <span style={{ width: `${config.length ? Math.round((configDone / config.length) * 100) : 0}%` }} />
            </div>
            <details open={Object.keys(configValues).length === 0}>
              <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                Parameters {Object.keys(configValues).length > 0 ? `· ${Object.keys(configValues).length} filled` : "— fill these in"}
              </summary>
              <div style={{ marginTop: 10 }}>
                <ConfiguratorForm projectId={project.id} fields={GENERATOR_FIELDS} values={configValues} />
              </div>
            </details>
            <ConfigChecklist projectId={project.id} items={configItems} />
          </details>
        )}

        {perms.rank >= 70 && (project.purchase_date || project.purchase_amount || project.sold_date || project.sold_amount) && (
          <div className="card">
            <h2 className="section-title">Purchase &amp; sale</h2>
            <div className="small" style={{ display: "grid", gap: 4 }}>
              {(project.purchase_date || project.purchase_amount) && (
                <span>
                  <span className="muted">Purchased:</span>{" "}
                  {project.purchase_date ?? "—"}
                  {project.purchase_amount && <> · ${Number(project.purchase_amount).toLocaleString()}</>}
                </span>
              )}
              {(project.sold_date || project.sold_amount) && (
                <span>
                  <span className="muted">Sold:</span>{" "}
                  {project.sold_date ?? "—"}
                  {project.sold_amount && <> · ${Number(project.sold_amount).toLocaleString()}</>}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Bids the caller was invited to answer (bidders, not managers). */}
        {myBids.length > 0 && (
          <div className="card" style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Bids to answer · {myBids.length}</h2>
            {myBids.map((b) => (
              <Link key={b.id} href={`/my/bid/${b.id}`} className="small"
                style={{ display: "flex", justifyContent: "space-between", gap: 10, textDecoration: "none", color: "inherit", borderTop: "1px solid #f0f1ee", paddingTop: 6 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                  <strong>{b.category ?? "Package"}</strong>{b.phase ? <span className="muted"> · {b.phase}</span> : null}
                </span>
                <span className="muted" style={{ whiteSpace: "nowrap" }}>{b.status}{b.reply_by ? ` · by ${b.reply_by}` : ""}</span>
              </Link>
            ))}
          </div>
        )}

        {/* The job ladder: tasks → create a bid → invite bidders → award. */}
        <div className="card">
          <h2 className="section-title" style={{ margin: 0 }}>Tasks · {openCount} open · {doneCount} done</h2>
          {perms.rank >= 50 && (
            <details id="add-task" className="card" style={{ marginBottom: 4 }} open={!!assignContact}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>＋ Add a task</summary>
              <div style={{ marginTop: 10 }}>
                <AddTaskForm projects={[{ id: project.id, name: project.project_name }]} members={taskMembers}
                  defaultAssignee={assignContact} />
              </div>
            </details>
          )}
          {projectTasks.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing here yet.</p>}
          {projectTasks.length > 0 && (
            <TasksTable tasks={projectTasks} todayIso={todayIso} savedFilters filtersInSetup showTradeTiles={false} showLatePanels avatars={avatars}
              initialParent={parentTask ?? null}
              initialState={initialTaskState} initialView={initialTaskView} />
          )}
        </div>

        {perms.rank >= 50 && (
          <>
            {/* Stage 1 — Create a bid */}
            <div className="card" style={{ display: "grid", gap: 6, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <h2 className="section-title" style={{ margin: 0 }}>1 · Create a bid · {bidPkgs.length} package{bidPkgs.length === 1 ? "" : "s"}</h2>
                <Link className={bidPkgs.length === 0 ? "btn small" : "btn ghost small"} href={`/my/project/${project.id}/bids`}>
                  {bidPkgs.length === 0 ? "＋ Create a bid package" : "Open planner →"}
                </Link>
              </div>
              {bidPkgs.length === 0
                ? <p className="muted small" style={{ margin: 0 }}>Start a package from a budget line. The brief above travels with it, so bidders price from the owner&apos;s own words and photos.</p>
                : bidPkgs.map((p) => (
                  <Link key={p.id} href={`/my/project/${project.id}/bids/${p.id}`} className="small"
                    style={{ display: "flex", justifyContent: "space-between", gap: 10, textDecoration: "none", color: "inherit", borderTop: "1px solid #f0f1ee", paddingTop: 6 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                      <span className="muted">{p.phase ?? "—"} · </span><strong>{p.category ?? p.trade ?? "Package"}</strong>
                    </span>
                    <span className="muted" style={{ whiteSpace: "nowrap" }}>{p.status}</span>
                  </Link>
                ))}
            </div>

            {/* Stage 2 — Invite bidders */}
            <div className="card" style={{ display: "grid", gap: 6, minWidth: 0 }}>
              <h2 className="section-title" style={{ margin: 0 }}>2 · Invite bidders · {totalInvited} invited · {totalReceived} replied</h2>
              {bidPkgs.length === 0
                ? <p className="muted small" style={{ margin: 0 }}>Create a package first, then invite from the People on this project. Bidders reply through their portal account.</p>
                : bidPkgs.map((p) => (
                  <div key={p.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", borderTop: "1px solid #f0f1ee", paddingTop: 6, minWidth: 0 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                      <strong>{p.category ?? p.trade ?? "Package"}</strong> <span className="muted">· {p.n_received}/{p.n_invited} replies{p.reply_by ? ` · by ${p.reply_by}` : ""}</span>
                    </span>
                    <Link href={`/my/project/${project.id}/bids/${p.id}`} className="btn ghost small" style={{ whiteSpace: "nowrap" }}>
                      {p.n_invited === 0 ? "Invite →" : "Invite more →"}
                    </Link>
                  </div>
                ))}
            </div>

            {/* Stage 3 — Award */}
            <div className="card" style={{ display: "grid", gap: 6, minWidth: 0 }}>
              <h2 className="section-title" style={{ margin: 0 }}>3 · Award project · {wonBids.length} awarded</h2>
              {bidPkgs.length === 0 && <p className="muted small" style={{ margin: 0 }}>Awarding opens once replies are in. Negotiate two rounds first — never after awarding.</p>}
              {bidPkgs.map((p) => {
                const w = wonByPkg.get(p.id);
                return (
                  <div key={p.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", borderTop: "1px solid #f0f1ee", paddingTop: 6, minWidth: 0 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                      <strong>{p.category ?? p.trade ?? "Package"}</strong>{" "}
                      {w
                        ? <span style={{ color: "#2f6b4f" }}>✅ awarded to {w.contacts?.person_name ?? w.contacts?.name ?? "—"}{w.amount != null ? ` · $${Math.round(w.amount).toLocaleString()}` : ""}</span>
                        : <span className="muted">· {p.n_received > 0 ? `${p.n_received} repl${p.n_received === 1 ? "y" : "ies"} to review` : "waiting for replies"}</span>}
                    </span>
                    {!w && p.n_received > 0 && (
                      <Link href={`/my/project/${project.id}/bids/${p.id}`} className="btn small" style={{ whiteSpace: "nowrap" }}>Review &amp; award →</Link>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}


        {/* Inviting lives on the top bar (＋ Invite by Setup), not here. */}

        {peopleRows.length > 0 && (
          // minWidth 0 + overflow hidden at every level so a long task title
          // truncates instead of widening the page.
          <div className="card" style={{ display: "grid", gap: 6, minWidth: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <h2 className="section-title" style={{ margin: 0 }}>People · {visiblePeople.length}{!showAllPeople && visiblePeople.length < peopleRows.length ? ` of ${peopleRows.length}` : ""}</h2>
              {peopleRows.length > activePeople.length && (
                showAllPeople
                  ? <Link href={`/my/project/${project.id}`} className="small">Active only</Link>
                  : <Link href={`/my/project/${project.id}?people=all`} className="small">Show all {peopleRows.length}</Link>
              )}
            </div>
            <div className="muted" style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr 0.55fr 0.9fr 0.9fr 0.45fr 0.45fr", gap: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
              <span>Trade</span><span>Name</span><span>Open</span><span>Owed</span><span>Paid</span><span>Call</span><span>Task</span>
            </div>
            {/* Click a row to open the person's card: every task they're connected to. */}
            {visiblePeople.map((p) => (
              <details key={p.contactId} style={{ borderTop: "1px solid #eef0ec", paddingTop: 6, minWidth: 0, overflow: "hidden" }}>
                <summary className="small" style={{ cursor: "pointer", listStyle: "none", display: "grid", gridTemplateColumns: "1fr 1.6fr 0.55fr 0.9fr 0.9fr 0.45fr 0.45fr", gap: 8, alignItems: "center", minWidth: 0 }}>
                  <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.trade ?? "—"}</span>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span>{p.open}</span>
                  <span style={{ color: p.balance > 0 ? "#a8842c" : undefined, whiteSpace: "nowrap" }}>
                    {p.balance > 0 ? `$${Math.round(p.balance).toLocaleString()}` : "—"}
                  </span>
                  <span style={{ color: p.paid > 0 ? "#2f6b4f" : undefined, whiteSpace: "nowrap" }}>
                    {p.paid > 0 ? `$${Math.round(p.paid).toLocaleString()}` : "—"}
                  </span>
                  <span>
                    {p.phone
                      ? <a href={`tel:${p.phone}`} title={`Call ${p.name}`} style={{ textDecoration: "none" }}>📞</a>
                      : <span className="muted">—</span>}
                  </span>
                  <span>
                    {perms.rank >= 50
                      ? <Link href={`/my/project/${project.id}?assign=${p.contactId}#add-task`} title={`Create a task for ${p.name}`} style={{ textDecoration: "none", fontWeight: 700 }}>＋</Link>
                      : <span className="muted">—</span>}
                  </span>
                </summary>
                <div style={{ display: "grid", gap: 3, padding: "6px 0 4px", minWidth: 0 }}>
                  {/* Edit the person's contact record in place (gated server-side). */}
                  {perms.rank >= 50 && (
                    <details style={{ marginBottom: 4 }}>
                      <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>✏️ Edit contact</summary>
                      <form action={updateContact} style={{ display: "grid", gap: 6, padding: "6px 0 2px" }}>
                        <input type="hidden" name="contact" value={p.contactId} />
                        <input type="hidden" name="back" value={`/my/project/${project.id}`} />
                        <div className="form-2col">
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label>Name</label>
                            <input name="name" className="input" defaultValue={p.name} />
                          </div>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label>Trade</label>
                            <input name="trade" className="input" defaultValue={p.trade ?? ""} placeholder="e.g. Plumbing" />
                          </div>
                        </div>
                        <div className="form-2col">
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label>Phone</label>
                            <input name="phone" className="input" type="tel" defaultValue={p.phone ?? ""} />
                          </div>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label>Email</label>
                            <input name="email" className="input" type="email" defaultValue={p.email ?? ""} />
                          </div>
                        </div>
                        <div><button className="btn small">Save contact</button></div>
                      </form>
                    </details>
                  )}
                  {p.tasks.length === 0 && <span className="muted small">No tasks connected.</span>}
                  {p.tasks.map((t) => (
                    <Link key={t.id} href={`/my/task/${t.id}`} className="small"
                      style={{ display: "flex", justifyContent: "space-between", gap: 10, textDecoration: "none", color: "inherit", opacity: t.state === "closed" ? 0.6 : 1, minWidth: 0, maxWidth: "100%" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{t.action}</span>
                      <span className="muted" style={{ whiteSpace: "nowrap", flex: "none" }}>{t.state === "closed" ? t.status : (t.target_date ?? "—")}</span>
                    </Link>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
