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
  searchParams: Promise<{ saved?: string; ok?: string; error?: string; tasks?: string; assign?: string; parent?: string }>;
}) {
  const { id } = await params;
  const { saved, ok: flashOk, error, tasks: tasksBucket, assign: assignContact, parent: parentTask } = await searchParams;
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

        {/* What the owner asked for: description, specs, photos. Travels
            with every bid package as the scope bidders price from. */}
        {project.parent_project_id && <ProjectBrief projectId={project.id} />}

        {config.length > 0 && (
          <div className="card" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <h2 className="section-title" style={{ margin: 0 }}>Configuration · {configDone} of {config.length} done</h2>
              <span className="muted small">Complete these so the work can be priced and scheduled.</span>
            </div>
            <div className="progressbar">
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
          </div>
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

        {/* Bid planner: packages for managers; invitations to answer for bidders. */}
        {(perms.rank >= 50 || myBids.length > 0) && (
          <div className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <h2 className="section-title" style={{ margin: 0 }}>Bid planner · {bidPkgs.length} package{bidPkgs.length === 1 ? "" : "s"}</h2>
              {perms.rank >= 50 && <Link className="btn ghost small" href={`/my/project/${project.id}/bids`}>Open planner →</Link>}
            </div>
            {myBids.length > 0 && (
              <div style={{ display: "grid", gap: 4 }}>
                <span className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Bids to answer</span>
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
            {perms.rank >= 50 && bidPkgs.length > 0 && (
              <div style={{ display: "grid", gap: 4 }}>
                {bidPkgs.slice(0, 6).map((p) => (
                  <Link key={p.id} href={`/my/project/${project.id}/bids/${p.id}`} className="small"
                    style={{ display: "flex", justifyContent: "space-between", gap: 10, textDecoration: "none", color: "inherit", borderTop: "1px solid #f0f1ee", paddingTop: 6 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                      <span className="muted">{p.phase ?? "—"} · </span><strong>{p.category ?? p.trade ?? "Package"}</strong>
                    </span>
                    <span className="muted" style={{ whiteSpace: "nowrap" }}>{p.status} · {p.n_received}/{p.n_invited} replies</span>
                  </Link>
                ))}
              </div>
            )}
            {perms.rank >= 50 && bidPkgs.length === 0 && (
              <p className="muted small" style={{ margin: 0 }}>No packages yet — open the planner to start one from a budget line.</p>
            )}
          </div>
        )}

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
            <TasksTable tasks={projectTasks} todayIso={todayIso} savedFilters showTradeTiles={false} showLatePanels avatars={avatars}
              initialParent={parentTask ?? null}
              initialState={initialTaskState} initialView={initialTaskView} />
          )}
        </div>


        {/* Invite someone into this space. They accept or decline on their
            next login; the answer shows on the inviter's home page. */}
        {(perms.admin || perms.name || perms.status || perms.address) && (
          <details className="card" style={{ display: "grid", gap: 8 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>➕ Invite someone to this {project.parent_project_id ? "project" : "home"}</summary>
            <form action={inviteToProject} style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <input type="hidden" name="project" value={project.id} />
              <input type="hidden" name="back" value={`/my/project/${project.id}`} />
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="inv-contact">Their email or phone</label>
                  <input id="inv-contact" name="contact" className="input" required autoComplete="off" placeholder="name@example.com or 201-555-0100" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="inv-note">Note (optional)</label>
                  <input id="inv-note" name="note" className="input" defaultValue={`Please join ${project.project_name} to assist with `} />
                </div>
              </div>
              <div className="radio-row" style={{ minHeight: 0 }}>
                <label className="radio-opt"><input type="radio" name="seat" value="contractor" defaultChecked /> Contractor</label>
                <label className="radio-opt"><input type="radio" name="seat" value="viewer" /> Viewer</label>
                <label className="radio-opt"><input type="radio" name="seat" value="resident" /> Co-owner</label>
              </div>
              <p className="muted small" style={{ margin: 0 }}>Co-owner = runs the home with you: full authority, sees money. Viewer = read-only, no money.</p>
              <div className="btn-row" style={{ alignItems: "center" }}>
                <button className="btn small">Invite user</button>
                <Link href={`/my/invite?project=${project.id}`} className="small muted">Not on the platform yet? Send a signup link →</Link>
              </div>
            </form>
          </details>
        )}

        {peopleRows.length > 0 && (
          // minWidth 0 + overflow hidden at every level so a long task title
          // truncates instead of widening the page.
          <div className="card" style={{ display: "grid", gap: 6, minWidth: 0, overflow: "hidden" }}>
            <h2 className="section-title" style={{ margin: 0 }}>People · {peopleRows.length}</h2>
            <div className="muted" style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr 0.55fr 0.9fr 0.9fr 0.45fr 0.45fr", gap: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
              <span>Trade</span><span>Name</span><span>Open</span><span>Owed</span><span>Paid</span><span>Call</span><span>Task</span>
            </div>
            {/* Click a row to open the person's card: every task they're connected to. */}
            {peopleRows.map((p) => (
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
