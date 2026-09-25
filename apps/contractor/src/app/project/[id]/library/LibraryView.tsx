"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";

// The folder-like view (Shahar, 2026-09-24). Folders are VIEWS the database
// fills (portal_library, 228): a hand-filing, a trade walked through the
// file's links, or the contract / proposal scan. Dropping a file on a folder
// - its tile or its open shelf - uploads it (same order as Evidence: bytes
// first, record_project_file second, the filing third), so a files row never
// points at an object that is not there. Everything on no shelf shows at the
// end anyway: a delivery nobody filed is exactly what he wants to see.
export type LibFile = {
  id: string; file_name: string | null; kind: string | null; mime_type: string | null;
  size_bytes: number | null; caption: string | null; created_at: string;
  bucket: string; path: string; via: string; detail: string | null;
};
export type Folder = {
  id: string; name: string; trade: string | null; auto: string | null;
  sort_order: number; files: LibFile[];
};

const ICON: Record<string, string> = { photo: "🖼", video: "🎬", audio: "🎙", document: "📄", other: "📎" };
const VIA: Record<string, string> = {
  filed: "", trade: "by trade", contract: "on a contract", proposal: "on a proposal", loose: "",
};

const sz = (n: number | null) => {
  if (n == null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
const day = (iso: string) => iso.slice(0, 10);

// Minted outside the component: the strict-purity lint is right that render
// must not roll dice, and this only ever runs from an event.
const freshPath = (projectId: string, name: string) => {
  const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
  return `${projectId}/library/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
};

const g = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, width: 16, height: 16 };
const FolderGlyph = () => <svg {...g}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;

export function LibraryView({ projectId, folders, loose, trades, urls }: {
  projectId: string;
  folders: Folder[];
  loose: LibFile[];
  trades: string[];
  urls: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [overTile, setOverTile] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [, start] = useTransition();

  const openFolder = folders.find((f) => f.id === open) ?? null;

  // Upload into a folder: bytes, then the row, then the filing (Evidence's
  // order). Vercel caps server actions at 4.5 MB, so the browser talks to
  // storage directly - help topic files.
  async function uploadInto(folderId: string, list: FileList | File[]) {
    const files = [...list].filter((f) => f.size > 0);
    if (files.length === 0) return;
    setErr("");
    const supabase = createClient();
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      setBusy(files.length === 1 ? "Uploading…" : `Uploading ${i + 1} of ${files.length}…`);
      const path = freshPath(projectId, f.name);
      const { error: upErr } = await supabase.storage.from("project-media").upload(path, f, { contentType: f.type || undefined });
      if (upErr) { setErr(`${f.name} did not upload: ${upErr.message}`); break; }
      const { data, error } = await supabase.rpc("record_project_file", {
        p_project_id: projectId, p_path: path, p_file_name: f.name,
        p_mime: f.type || null, p_size: f.size, p_caption: null, p_kind: null,
      });
      if (error) { setErr(friendly(error.message)); break; }
      const id = (typeof data === "string" ? data : data?.file_id ?? data?.id ?? null) as string | null;
      if (!id) { setErr(`${f.name} was uploaded but not recorded.`); break; }
      const { data: filed, error: fileErr } = await supabase.rpc("portal_library_file", { p_file: id, p_folder: folderId });
      if (fileErr || filed?.ok === false) { setErr(filed?.reason ?? friendly(fileErr?.message ?? "The filing did not save.")); break; }
    }
    setBusy("");
    start(() => router.refresh());
  }

  async function fileInto(fileId: string, folderId: string, unfile = false) {
    setErr("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("portal_library_file", { p_file: fileId, p_folder: folderId, p_unfile: unfile });
    if (error || data?.ok === false) { setErr(data?.reason ?? friendly(error?.message ?? "That did not save.")); return; }
    start(() => router.refresh());
  }

  // Delete for good (Shahar, 2026-09-25): the row and its links go in one
  // call (portal_project_file_delete), then the bytes - same as the portal's
  // scope files. Unfile stays the gentle option beside it.
  async function deleteFile(f: LibFile) {
    if (!window.confirm(`Delete ${f.file_name ?? "this file"} for good? This cannot be undone.`)) return;
    setErr("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("portal_project_file_delete", { p_file_id: f.id });
    if (error) { setErr(friendly(error.message)); return; }
    const gone = data as { bucket: string | null; path: string | null } | null;
    if (gone?.bucket && gone.path) await supabase.storage.from(gone.bucket).remove([gone.path]);
    start(() => router.refresh());
  }

  async function addFolder(fd: FormData) {
    setErr("");
    const name = String(fd.get("name") ?? "").trim();
    if (!name) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("portal_library_folder_save", {
      p: { project_id: projectId, name, trade: String(fd.get("trade") ?? "") || null },
    });
    if (error || data?.ok === false) { setErr(data?.reason ?? friendly(error?.message ?? "That folder did not save.")); return; }
    setAdding(false);
    start(() => router.refresh());
  }

  async function removeFolder(folderId: string) {
    setErr("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("portal_library_folder_save", { p: { id: folderId, delete: true } });
    if (error || data?.ok === false) { setErr(data?.reason ?? friendly(error?.message ?? "That folder did not go.")); return; }
    setOpen(null);
    start(() => router.refresh());
  }

  const drops = (folderId: string) => ({
    onDragEnter: (e: React.DragEvent) => { e.preventDefault(); setOverTile(folderId); },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); },
    onDragLeave: () => setOverTile((t) => (t === folderId ? null : t)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setOverTile(null);
      if (e.dataTransfer?.files?.length) void uploadInto(folderId, e.dataTransfer.files);
    },
  });

  const fileRow = (f: LibFile, inFolder: Folder | null) => {
    const url = urls[`${f.bucket}/${f.path}`];
    const via = VIA[f.via] ?? f.via;
    return (
      <div key={`${inFolder?.id ?? "loose"}-${f.id}`} className="small"
        style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "5px 0",
          borderTop: "1px solid var(--color-divider)" }}>
        <span aria-hidden>{ICON[f.kind ?? "other"] ?? "📎"}</span>
        <span style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
          {url
            ? <a href={url} target="_blank" rel="noreferrer">{f.file_name ?? f.path.split("/").pop()}</a>
            : <span>{f.file_name ?? f.path.split("/").pop()}</span>}
          {(f.caption || f.detail || via) && (
            <span className="tiny text-muted" style={{ display: "block", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {[f.caption, via, f.detail].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
        <span className="tiny text-muted" style={{ whiteSpace: "nowrap" }}>{day(f.created_at)}{f.size_bytes ? ` · ${sz(f.size_bytes)}` : ""}</span>
        {inFolder && f.via === "filed" && (
          <span style={{ display: "flex", gap: 2 }}>
            <button type="button" className="btn btn-ghost small" onClick={() => void fileInto(f.id, inFolder.id, true)}>
              Unfile
            </button>
            <button type="button" className="btn btn-ghost small" style={{ color: "var(--color-danger)" }}
              onClick={() => void deleteFile(f)}>
              Delete
            </button>
          </span>
        )}
        {!inFolder && folders.length > 0 && (
          <select className="input small" defaultValue="" aria-label={`File ${f.file_name ?? "this"} into a folder`}
            style={{ maxWidth: 130, padding: "3px 6px" }}
            onChange={(e) => { if (e.target.value) void fileInto(f.id, e.target.value); }}>
            <option value="" disabled>File into…</option>
            {folders.filter((fo) => !fo.auto).map((fo) => <option key={fo.id} value={fo.id}>{fo.name}</option>)}
          </select>
        )}
      </div>
    );
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      {err && <p className="small" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
      {busy && <p className="small text-muted" style={{ margin: 0 }}>{busy}</p>}

      {/* THE SHELVES, in his order. A tile is also a drop target: let go of a
          file on it and it lands inside. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {folders.map((f) => (
          <button key={f.id} type="button"
            {...drops(f.id)}
            onClick={() => setOpen(open === f.id ? null : f.id)}
            className="card"
            style={{ textAlign: "left", padding: "10px 12px", cursor: "pointer", display: "grid", gap: 2,
              border: overTile === f.id ? "2px dashed var(--color-ok)"
                : open === f.id ? "2px solid var(--color-divider-strong)" : undefined }}>
            <span style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 700, fontSize: 13 }}>
              <FolderGlyph /> {f.name}
            </span>
            <span className="tiny text-muted">
              {f.files.length === 0 ? "empty" : `${f.files.length} file${f.files.length === 1 ? "" : "s"}`}
              {f.trade ? ` · ${f.trade}` : f.auto === "contracts" ? " · scans contracts" : f.auto === "proposals" ? " · scans proposals" : ""}
            </span>
          </button>
        ))}
        {adding ? (
          <form action={addFolder} className="card" style={{ padding: "10px 12px", display: "grid", gap: 6 }}>
            <input className="input small" name="name" placeholder="Folder name" autoFocus />
            <select className="input small" name="trade" defaultValue="">
              <option value="">Trade — none</option>
              {trades.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-secondary small">Add</button>
              <button type="button" className="btn btn-ghost small" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className="card" onClick={() => setAdding(true)}
            style={{ textAlign: "left", padding: "10px 12px", cursor: "pointer", color: "var(--color-muted)" }}>
            + Add a folder
          </button>
        )}
      </div>

      {/* THE OPEN SHELF: its files, and a drop area that says so. */}
      {openFolder && (
        <div className="card" {...drops(openFolder.id)} style={{ padding: "12px 14px", display: "grid", gap: 8,
          outline: overTile === openFolder.id ? "2px dashed var(--color-ok)" : undefined }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <strong>{openFolder.name}</strong>
            {openFolder.trade && <span className="tag tag-neutral">{openFolder.trade}</span>}
            {openFolder.auto && <span className="tiny text-muted">fills itself from {openFolder.auto === "contracts" ? "every contract" : "every proposal"}</span>}
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <label className="btn btn-secondary small" style={{ cursor: "pointer" }}>
                Add files
                <input type="file" multiple hidden
                  onChange={(e) => { if (e.target.files?.length) void uploadInto(openFolder.id, e.target.files); e.target.value = ""; }} />
              </label>
              {openFolder.files.length === 0 && (
                <button type="button" className="btn btn-ghost small" onClick={() => void removeFolder(openFolder.id)}>
                  Remove folder
                </button>
              )}
            </span>
          </div>
          {openFolder.files.length === 0
            ? <p className="small text-muted" style={{ margin: 0 }}>Nothing here yet — drop files anywhere on this box.</p>
            : <div>{openFolder.files.map((f) => fileRow(f, openFolder))}</div>}
        </div>
      )}

      {/* EVERYTHING ELSE: on no shelf at all - not filed, no trade a folder
          carries, not a contract or proposal document. Shown anyway. */}
      {loose.length > 0 && (
        <div className="card" style={{ padding: "12px 14px", display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <strong>Everything else</strong>
            <span className="tiny text-muted">{loose.length} file{loose.length === 1 ? "" : "s"} on no shelf — file each where it belongs</span>
          </div>
          <div>{loose.map((f) => fileRow(f, null))}</div>
        </div>
      )}
    </div>
  );
}
