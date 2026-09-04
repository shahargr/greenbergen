"use client";

import { useState } from "react";
import { saveProject, deleteProject, type ProjectPerms } from "./actions";
import { PROJECT_STAGES, STAGE_LABEL } from "@/lib/stages";

type ProjectView = {
  id: string;
  project_name: string;
  status: string | null;
  stage: string | null;
  address: string | null;
  notes: string | null;
};

// The definition panel edits the stage; status (open / closed) is a record
// fact and lives on the Admin tab.

// Unlock-to-edit, same contract as the task editor: everything reads as
// text until unlocked; unlocked, only the fields your rank allows become
// inputs - and the server re-checks every one on save.
type Crumb = { id: string; name: string; href: string | null };

// Owner › parent › … › this project. Parents link; the ends are plain.
function Hierarchy({ crumbs, maskOwner = false }: { crumbs: Crumb[]; maskOwner?: boolean }) {
  if (crumbs.length === 0) return null;
  return (
    <div className="small" style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 4, minWidth: 0 }}>
      {crumbs.map((c, i) => (
        <span key={c.id} style={{ display: "inline-flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
          {i > 0 && <span className="muted">›</span>}
          {c.href
            ? <a href={c.href} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</a>
            : <span title={maskOwner && c.id === "owner" ? "Owner details are shown once the work is awarded" : undefined}
                style={{ fontWeight: i === crumbs.length - 1 ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", filter: maskOwner && c.id === "owner" ? "blur(4px)" : undefined, userSelect: maskOwner && c.id === "owner" ? "none" : undefined }}>{c.name}</span>}
        </span>
      ))}
    </div>
  );
}

// The delete zone, on its own so the page can put it dead last.
export function DeleteProjectZone({ project, perms }: { project: ProjectView; perms: ProjectPerms }) {
  const [confirmName, setConfirmName] = useState("");
  if (perms.rank < 70) return null;
  return (
    <div className="card" style={{ borderLeft: "3px solid #c0262d", display: "grid", gap: 8 }}>
      <strong className="small" style={{ color: "#c0262d" }}>Danger zone — delete project</strong>
      <p className="muted small" style={{ margin: 0 }}>
        Deleting is a two-step: this sends a request to the project owner
        as an approval task. Once approved, the project — tasks, media and
        all — moves to the recycle bin (restorable from Settings for the
        retention window). Type the project name to confirm.
      </p>
      <form
        action={deleteProject.bind(null, project.id)}
        onSubmit={(e) => { if (confirmName !== project.project_name) e.preventDefault(); }}
        className="btn-row"
      >
        <input className="input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
          placeholder={`Type "${project.project_name}"`} style={{ maxWidth: 260 }} />
        <button className="btn" style={{ background: "#c0262d" }} disabled={confirmName !== project.project_name}>
          Request deletion
        </button>
      </form>
    </div>
  );
}

export function ProjectEditor({ project, perms, crumbs = [], briefSlot, defaultOpen = false, showActions = true, showDelete = true, maskOwner = false }: { project: ProjectView; perms: ProjectPerms; crumbs?: Crumb[]; briefSlot?: React.ReactNode; defaultOpen?: boolean; showActions?: boolean; showDelete?: boolean; maskOwner?: boolean }) {
  const [setup, setSetup] = useState(defaultOpen);
  const [confirmName, setConfirmName] = useState("");
  const canEditAnything = perms.name || perms.notes || perms.status || perms.address;
  const canDelete = perms.rank >= 70;
  const save = saveProject.bind(null, project.id);

  // Closed: just the read-only details and one Setup button.
  if (!setup) {
    return (
      <div className="card" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Details</h2>
          {showActions && <span className="btn-row" style={{ gap: 6 }}>
            {canEditAnything && (
              <a href={`/my/invite?project=${project.id}`} className="btn ghost small" title="Invite someone to this space">➕ Invite</a>
            )}
            {(canEditAnything || canDelete) && (
              <button className="btn ghost small" onClick={() => setSetup(true)}>⚙️ Setup</button>
            )}
          </span>}
        </div>
        <Hierarchy crumbs={crumbs} maskOwner={maskOwner} />
        <div className="small" style={{ display: "grid", gap: 4 }}>
          <span><span className="muted">Stage:</span> {project.stage ? (STAGE_LABEL[project.stage] ?? project.stage) : "not set"}</span>
          <span><span className="muted">Address:</span> {project.address ?? "—"}</span>
        </div>
      </div>
    );
  }

  // Open: Setup starts with the edit scope; the delete option lives all the
  // way at the bottom, under a danger-zone divider.
  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ margin: 0 }}>Setup</h2>
        <button type="button" className="btn ghost small" onClick={() => setSetup(false)}>Close</button>
      </div>

      {/* The project brief (description, specs, photos) lives here in Setup. */}
      {briefSlot}

      {canEditAnything ? (
        <form action={save} style={{ display: "grid", gap: 10 }}>
          {perms.name && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pe-name">Name</label>
              <input id="pe-name" name="name" className="input" defaultValue={project.project_name} required />
            </div>
          )}
          {perms.status && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pe-stage">Stage</label>
              <select id="pe-stage" name="stage" className="input" defaultValue={project.stage ?? "active"}>
                {PROJECT_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s] ?? s}</option>)}
              </select>
              <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
                Where the work stands. Whether the project is open or closed is a record fact, on the Admin tab.
              </p>
            </div>
          )}
          {perms.address && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pe-address">Address</label>
              <input id="pe-address" name="address" className="input" defaultValue={project.address ?? ""} />
            </div>
          )}
          {perms.notes && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pe-notes">Notes</label>
              <textarea id="pe-notes" name="notes" className="input" rows={4} defaultValue={project.notes ?? ""} />
            </div>
          )}
          <div className="btn-row">
            <button className="btn">Save</button>
          </div>
        </form>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>You don&apos;t have edit rights on this project&apos;s details.</p>
      )}

      {showDelete && canDelete && (
        <div style={{ borderTop: "1px solid #e3b7ba", paddingTop: 12, display: "grid", gap: 8 }}>
          <strong className="small" style={{ color: "#c0262d" }}>Danger zone — delete project</strong>
          <p className="muted small" style={{ margin: 0 }}>
            Deleting moves this project — tasks, media and all — to the
            recycle bin (restorable from Settings for the retention
            window). Type the project name to confirm.
          </p>
          <form
            action={deleteProject.bind(null, project.id)}
            onSubmit={(e) => { if (confirmName !== project.project_name) e.preventDefault(); }}
            className="btn-row"
          >
            <input
              className="input"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={`Type "${project.project_name}"`}
              style={{ maxWidth: 260 }}
            />
            <button
              className="btn"
              style={{ background: "#c0262d" }}
              disabled={confirmName !== project.project_name}
            >
              Move to recycle bin
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
