import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TaskEditor, type TaskView, type MemberOption, type CommentView } from "./TaskEditor";
import { TaskTransactions, type TaskTx, type PayMethod } from "./TaskTransactions";
import { SubtaskRow, type Subtask } from "./SubtaskRow";
import { taskPerms } from "./actions";
import { getCaps, acceptFor } from "@/lib/caps";

export const maxDuration = 60;

const CLOSED = ["Completed", "Cancelled", "Force Cancelled"];

type TaskFull = {
  id: string; action: string | null; status: string; priority: string | null;
  target_date: string | null; desired_outcome: string | null; notes: string | null;
  dependencies: string | null; learnings: string | null; pending_on: string | null;
  pending_reason: string | null; requires_photo_evidence: boolean | null;
  is_gate: boolean | null; cadence: string | null; created_at: string;
  created_by: string | null; source: string | null; project_id: string | null;
  assigned_to_contact_id: string | null; assigned_to_persona_id: string | null;
  assigned_by: string | null; inquiry_id: string | null; follows_action_id: string | null; parent_action_id: string | null;
  projects: { project_name: string | null } | null;
};

// One task, every exposed field, edit rights decided by the permission
// matrix (recomputed server-side on save - the UI is a convenience, the
// action is the law).
export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { saved, error } = await searchParams;
  const supabase = await createClient();
  const caps = await getCaps();

  const { data: rawTask } = await supabase
    .from("actions")
    .select(
      "id, action, status, priority, target_date, desired_outcome, notes, dependencies, learnings, " +
      "pending_on, pending_reason, requires_photo_evidence, is_gate, cadence, created_at, created_by, " +
      "source, project_id, assigned_to_contact_id, assigned_to_persona_id, assigned_by, inquiry_id, follows_action_id, parent_action_id, " +
      "projects(project_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!rawTask) notFound();
  const t = rawTask as unknown as TaskFull;

  const [perms, { data: commentRows }, { count: evidenceCount }, { data: assigneeContact }, { data: assigneePersona }, { data: memberRows }, { data: tradeRows }, { data: childRows }] =
    await Promise.all([
      taskPerms(t.project_id, t.assigned_to_contact_id),
      supabase
        .from("task_comments")
        .select("id, author_name, body, created_at")
        .eq("action_id", t.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("file_links")
        .select("id", { count: "exact", head: true })
        .eq("action_id", t.id)
        .in("role", ["after", "evidence", "before", "progress"]),
      t.assigned_to_contact_id
        ? supabase.from("contacts").select("name, person_name").eq("id", t.assigned_to_contact_id).maybeSingle()
        : Promise.resolve({ data: null }),
      t.assigned_to_persona_id
        ? supabase.from("personas").select("name").eq("id", t.assigned_to_persona_id).maybeSingle()
        : Promise.resolve({ data: null }),
      t.project_id
        ? supabase
            .from("project_members")
            .select("contact_id, contacts(name, person_name)")
            .eq("project_id", t.project_id)
            .eq("status", "active")
            .not("contact_id", "is", null)
        : Promise.resolve({ data: [] }),
      supabase.from("trades").select("trade, is_construction, is_worker_trade").order("sort_order"),
      // Open subtasks: they block closing the parent, so link to them here.
      supabase
        .from("actions")
        .select("id, action, status, priority, target_date, notes")
        .eq("parent_action_id", id)
        .not("status", "in", '("Completed","Cancelled","Force Cancelled","Superseded")')
        .order("target_date", { ascending: true, nullsFirst: false }),
    ]);
  const openChildren = ((childRows ?? []) as Subtask[]);
  // The chain this task sits in: what it follows, and what follows it.
  type ChainLink = { id: string; action: string | null; status: string };
  const [{ data: prevRow }, { data: nextRows }] = await Promise.all([
    t.follows_action_id
      ? supabase.from("actions").select("id, action, status").eq("id", t.follows_action_id).maybeSingle()
      : Promise.resolve({ data: null as ChainLink | null }),
    supabase.from("actions").select("id, action, status").eq("follows_action_id", id).order("created_at"),
  ]);
  const chainPrev = (prevRow ?? null) as ChainLink | null;
  const chainNext = ((nextRows ?? []) as ChainLink[]);

  // Breadcrumb: home › house › project › parent task(s) › this task.
  // Project parents and task parents are both walked upward, capped so a
  // bad self-reference can never loop.
  type Crumb = { key: string; label: string; href: string | null };
  const projectCrumbs: Crumb[] = [];
  let projCursor: string | null = t.project_id;
  for (let i = 0; projCursor && i < 6; i += 1) {
    const { data: pr } = await supabase.from("projects").select("id, project_name, parent_project_id").eq("id", projCursor).maybeSingle();
    if (!pr) break;
    projectCrumbs.unshift({ key: pr.id, label: pr.project_name, href: `/my/project/${pr.id}` });
    projCursor = pr.parent_project_id as string | null;
  }
  const taskCrumbs: Crumb[] = [];
  let taskCursor: string | null = t.parent_action_id;
  for (let i = 0; taskCursor && i < 6; i += 1) {
    const { data: pa } = await supabase.from("actions").select("id, action, parent_action_id").eq("id", taskCursor).maybeSingle();
    if (!pa) break;
    taskCrumbs.unshift({ key: pa.id, label: pa.action ?? "(untitled)", href: `/my/task/${pa.id}` });
    taskCursor = pa.parent_action_id as string | null;
  }
  const crumbs: Crumb[] = [{ key: "home", label: "Home", href: "/my" }, ...projectCrumbs];
  const parentCrumb = taskCrumbs.length > 0 ? taskCrumbs[taskCrumbs.length - 1] : null;
  const comments = (commentRows ?? []) as CommentView[];

  const allTrades = ((tradeRows ?? []) as { trade: string; is_construction: boolean | null; is_worker_trade: boolean | null }[]);
  const tradeNames = allTrades.filter((t) => t.is_construction || t.is_worker_trade).map((t) => t.trade);

  const memberIds = ((memberRows ?? []) as unknown as { contact_id: string }[]).map((m) => m.contact_id);
  const { data: memberTradeRows } = memberIds.length
    ? await supabase.from("contact_trade_roles").select("contact_id, trade").in("contact_id", memberIds)
    : { data: [] };
  const okTrade = new Set(tradeNames);
  const tradeOf = new Map<string, string>();
  for (const r of (memberTradeRows ?? []) as { contact_id: string; trade: string }[]) {
    if (!tradeOf.has(r.contact_id) && okTrade.has(r.trade)) tradeOf.set(r.contact_id, r.trade);
  }

  const members: MemberOption[] = ((memberRows ?? []) as unknown as {
    contact_id: string;
    contacts: { name: string | null; person_name: string | null } | null;
  }[])
    .map((m) => ({
      contactId: m.contact_id,
      name: m.contacts?.person_name ?? m.contacts?.name ?? "Unnamed",
      trade: tradeOf.get(m.contact_id) ?? null,
    }))
    .filter((m, i, arr) => arr.findIndex((x) => x.contactId === m.contactId) === i)
    .sort((a, b) => a.name.localeCompare(b.name));

  const view: TaskView = {
    id: t.id,
    action: t.action ?? "",
    status: t.status,
    priority: t.priority,
    target_date: t.target_date,
    desired_outcome: t.desired_outcome,
    notes: t.notes,
    dependencies: t.dependencies,
    learnings: t.learnings,
    pending_on: t.pending_on,
    pending_reason: t.pending_reason,
    requires_photo_evidence: t.requires_photo_evidence ?? false,
    is_gate: t.is_gate ?? false,
    cadence: t.cadence,
    created_at: t.created_at,
    created_by: t.created_by,
    source: t.source,
    projectName: t.projects?.project_name ?? null,
    assignedToName:
      (assigneeContact?.person_name as string | undefined) ??
      (assigneeContact?.name as string | undefined) ??
      (assigneePersona?.name as string | undefined) ??
      null,
    assignedByName: t.assigned_by,
    assignedToContactId: t.assigned_to_contact_id,
  };

  const isOpen = !CLOSED.includes(view.status);

  // Transactions clubbed under this task, plus the project's unattached ones
  // to search/attach from. A transaction carries one action_id (many per task).
  const TX_COLS = "id, description, amount, paid_on, status, paid_from_account";
  const [{ data: attachedTxRows }, { data: candidateTxRows }, { data: methodRows }] = await Promise.all([
    supabase.from("transactions").select(TX_COLS)
      .eq("action_id", t.id).eq("direction", "out")
      .order("paid_on", { ascending: false, nullsFirst: false }),
    t.project_id
      ? supabase.from("transactions").select(TX_COLS)
          .eq("project_id", t.project_id).eq("direction", "out").is("action_id", null)
          .order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] }),
    supabase.from("payment_methods").select("id, name").eq("is_active", true)
      .order("display_order", { ascending: true, nullsFirst: false }),
  ]);
  const attachedTx = (attachedTxRows ?? []) as TaskTx[];
  const candidateTx = (candidateTxRows ?? []) as TaskTx[];

  // Evidence on this task - shown, not just counted. Signed URLs, one hour.
  type EvidenceRow = { id: string; role: string; created_at: string; files: { id: string; bucket: string; path: string; file_name: string; kind: string | null; mime_type: string | null } | null };
  const { data: evidenceRows } = await supabase
    .from("file_links")
    .select("id, role, created_at, files(id, bucket, path, file_name, kind, mime_type)")
    .eq("action_id", t.id)
    .order("created_at", { ascending: false });
  const evidence = ((evidenceRows ?? []) as unknown as EvidenceRow[]).filter((e) => e.files);
  const evidenceUrls = new Map<string, string>();
  await Promise.all(evidence.map(async (e) => {
    const { data: s } = await supabase.storage.from(e.files!.bucket).createSignedUrl(e.files!.path, 3600);
    if (s?.signedUrl) evidenceUrls.set(e.id, s.signedUrl);
  }));
  // Rendered inside the editor, directly under the comment / photo card.
  const evidencePanel = evidence.length > 0 ? (
    <div className="card" style={{ display: "grid", gap: 8 }}>
      <h2 className="section-title" style={{ margin: 0 }}>Evidence · {evidence.length}</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {evidence.map((e) => {
          const f = e.files!;
          const u = evidenceUrls.get(e.id);
          const isImg = (f.mime_type ?? "").startsWith("image/") || f.kind === "photo";
          if (isImg && u) {
            return (
              <a key={e.id} href={u} target="_blank" rel="noreferrer" title={`${f.file_name} · ${e.role} · ${new Date(e.created_at).toLocaleDateString()}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={f.file_name} style={{ width: 110, height: 110, objectFit: "cover", borderRadius: 10, border: "1px solid #e7e9e4" }} />
                <div className="muted" style={{ fontSize: 10, textAlign: "center", marginTop: 2 }}>{e.role}</div>
              </a>
            );
          }
          const icon = f.kind === "audio" ? "🎙" : "📄";
          return u
            ? <a key={e.id} href={u} target="_blank" rel="noreferrer" className="extra-chip" style={{ textDecoration: "none" }}>{icon} {f.file_name} <span className="muted">· {e.role}</span></a>
            : <span key={e.id} className="extra-chip">{icon} {f.file_name} <span className="muted">· not uploaded yet</span></span>;
        })}
      </div>
    </div>
  ) : null;
  const payMethods = (methodRows ?? []) as PayMethod[];
  // Suggestions for the create form: people on the project, and the accounts
  // this project has actually paid from.
  const payeeNames = members.map((m) => m.name);
  const accountNames = [...new Set(candidateTx.map((x) => x.paid_from_account).filter((a): a is string => !!a))].sort();

  return (
    <main className="wrap" style={{ paddingTop: 24, paddingBottom: 64, maxWidth: 680 }}>
      <nav aria-label="Breadcrumb" className="small" style={{ margin: "0 0 10px", display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 4, minWidth: 0 }}>
        {crumbs.map((c, i) => (
          <span key={c.key} style={{ display: "inline-flex", alignItems: "baseline", gap: 4, minWidth: 0, maxWidth: "100%" }}>
            {i > 0 && <span className="muted">›</span>}
            {c.href
              ? <Link href={c.href} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{c.label}</Link>
              : <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{c.label}</span>}
          </span>
        ))}
      </nav>
      {/* Where this task sits: its parent (if any) and itself, named as such. */}
      <div className="small" style={{ margin: "0 0 8px", display: "grid", gap: 2, minWidth: 0 }}>
        {parentCrumb && (
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>Parent</span>{" "}
            <Link href={parentCrumb.href ?? "#"}>{parentCrumb.label}</Link>
          </div>
        )}
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: parentCrumb ? 14 : 0 }}>
          {parentCrumb && <span className="muted">↳ </span>}
          <span className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>{parentCrumb ? "Child" : openChildren.length > 0 ? "Parent" : "Task"}</span>{" "}
          <strong>{t.action ?? "(untitled)"}</strong>
          {openChildren.length > 0 && <span className="muted"> · {openChildren.length} open subtask{openChildren.length === 1 ? "" : "s"}</span>}
        </div>
      </div>
      {error && <p className="error small">{error}</p>}
      {!isOpen && <p className="muted small">This task is {view.status.toLowerCase()} — read-only.</p>}
      {(chainPrev || chainNext.length > 0) && (
        <p className="small" style={{ margin: "0 0 10px", display: "flex", gap: 14, flexWrap: "wrap" }}>
          {chainPrev && (
            <span>⛓ Follows <Link href={`/my/task/${chainPrev.id}`}>{chainPrev.action ?? "(untitled)"}</Link> <span className="muted">· {chainPrev.status}</span></span>
          )}
          {chainNext.map((n) => (
            <span key={n.id}>→ Followed by <Link href={`/my/task/${n.id}`}>{n.action ?? "(untitled)"}</Link> <span className="muted">· {n.status}</span></span>
          ))}
        </p>
      )}
      {openChildren.length > 0 && (
        <div className="card" style={{ display: "grid", gap: 6, marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Open subtasks · {openChildren.length}</h2>
          <p className="muted small" style={{ margin: 0 }}>These must be closed before this task can be completed. Edit any of them right here.</p>
          {openChildren.map((ch) => (
            <SubtaskRow key={`${ch.id}|${saved ?? ""}|${error ?? ""}`} task={ch} parentId={t.id} />
          ))}
        </div>
      )}
      {/* Keyed on saved/error so the editor remounts after a redirect back to
          this page — otherwise a client-side "Applying..." can stick after an
          error (Next keeps client state across a same-route searchParams change). */}
      <TaskEditor key={`${saved ?? ""}|${error ?? ""}`} task={view} perms={perms} parentName={parentCrumb?.label ?? null} childCount={openChildren.length} caps={{ ...caps, accept: acceptFor(caps) }} members={members} comments={comments} trades={tradeNames} isOpen={isOpen} evidenceCount={evidenceCount ?? 0} evidenceSlot={evidencePanel} />
      <div style={{ marginTop: 14 }}>
        <TaskTransactions
          key={`tx|${saved ?? ""}|${error ?? ""}`}
          taskId={t.id} attached={attachedTx} candidates={candidateTx} canEdit={perms.status}
          methods={payMethods} payees={payeeNames} accounts={accountNames}
        />
      </div>
    </main>
  );
}
