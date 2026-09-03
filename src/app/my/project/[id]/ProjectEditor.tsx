"use client";

import { useState } from "react";
import { saveProject, deleteProject, type ProjectPerms } from "./actions";

type ProjectView = {
  id: string;
  project_name: string;
  status: string | null;
  address: string | null;
  notes: string | null;
};

const PROJECT_STATUSES = ["In Progress", "Closed - Completed", "Closed - Incomplete"];

// Unlock-to-edit, same contract as the task editor: everything reads as
// text until unlocked; unlocked, only the fields your rank allows become
// inputs - and the server re-checks every one on save.
export function ProjectEditor({ project, perms }: { project: ProjectView; perms: ProjectPerms }) {
  const [setup, setSetup] = useState(false);
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
          <span className="btn-row" style={{ gap: 6 }}>
            {canEditAnything && (
              <a href={`/my/invite?project=${project.id}`} className="btn ghost small" title="Invite someone to this space">➕ Invite</a>
            )}
            {(canEditAnything || canDelete) && (
              <button className="btn ghost small" onClick={() => setSetup(true)}>⚙️ Setup</button>
            )}
          </span>
        </div>
        <div className="small" style={{ display: "grid", gap: 4 }}>
          <span><span className="muted">Status:</span> {project.status ?? "—"}</span>
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
              <label htmlFor="pe-status">Status</label>
              <select id="pe-status" name="status" className="input" defaultValue={project.status ?? "In Progress"}>
                {PROJECT_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
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

      {canDelete && (
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
