"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";
import { ChevronIcon } from "@shared/ui";

// THE PROJECT'S FACE, AND THE THINGS YOU SET ONCE.
//
// Shahar (2026-09-11), on the Scope row sitting in the middle of the running
// screen: "This is a one-time effort normally done when the project is
// created. You can add a Gear/configure icon on the top right side of the
// project image, allowing to define scope and update the photo. This will
// replace the change photo as well."
//
// And then: "move the cancel this job into the setting of it."
//
// So the gear is the door to everything you do to the JOB rather than to the
// work on it: the photo, the scope, and how it ends. The screen below it is
// only about the job running. `lifecycle` is server-rendered on the page -
// those forms post to server actions and have no business being in a client
// component - and is simply given a place here.
export function ProjectSetup({ projectId, url, own, stock, canEdit, scopeLines, scopeTrades, lifecycle }: {
  projectId: string; url: string | null; own: boolean; stock: boolean; canEdit: boolean;
  scopeLines: number; scopeTrades: number; lifecycle?: React.ReactNode;
}) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function upload(list: FileList | null) {
    const file = Array.from(list ?? []).find((f) => f.size > 0);
    if (!file) return;
    setErr(""); setBusy("Uploading…");
    const supabase = createClient();
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
    const path = `${projectId}/photos/${Date.now()}${ext}`;
    const { error: upErr } = await supabase.storage.from("project-media")
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) { setBusy(""); setErr(`${file.name}: ${upErr.message}`); return; }

    const { data: rec, error: recErr } = await supabase.rpc("record_project_file", {
      p_project_id: projectId, p_path: path, p_file_name: file.name || `photo${ext}`,
      p_mime: file.type || null, p_size: file.size, p_caption: "Project photo", p_kind: "photo",
    });
    if (recErr) { setBusy(""); setErr(friendly(recErr.message)); return; }
    const fileId = (typeof rec === "string" ? rec : rec?.file_id ?? rec?.id ?? null) as string | null;
    if (!fileId) { setBusy(""); setErr("The photo was uploaded but not recorded."); return; }

    const { data, error } = await supabase.rpc("project_cover_set", { p_project: projectId, p_file_id: fileId });
    setBusy("");
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "Could not set the photo."); return; }
    setOpen(false);
    router.refresh();
  }

  const input = (
    <input ref={pick} type="file" accept="image/*" hidden
      onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
  );

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ position: "relative" }}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="shot" src={url} alt=""
            style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: "var(--radius-tile)", display: "block" }} />
        ) : canEdit ? (
          <button type="button" className="cover-empty" disabled={!!busy} onClick={() => pick.current?.click()}>
            <span style={{ fontSize: 22 }} aria-hidden>📷</span>
            <strong>{busy || "Add a photo of this project"}</strong>
            <span className="tiny text-muted">It becomes the face on the board.</span>
          </button>
        ) : (
          <div className="cover-empty" aria-hidden><span style={{ fontSize: 22 }}>🏗</span></div>
        )}

        {canEdit && (
          <button type="button" className="cover-gear" aria-label="Set this project up"
            aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <GearIcon />
          </button>
        )}
      </div>

      {canEdit && !own && url && !open && (
        <p className="tiny text-muted" style={{ margin: 0 }}>
          {stock
            ? "Showing the standard photo for this kind of job until this project has one of its own."
            : "Showing the house's photo until this project has one of its own."}
        </p>
      )}
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}

      {/* Set-up, not running: opened from the gear, shut the rest of the time. */}
      {canEdit && open && (
        <div className="card pad stack" style={{ gap: 8 }}>
          <div className="between">
            <span className="small" style={{ fontWeight: 700 }}>Set this project up</span>
            <button type="button" className="btn btn-ghost small" onClick={() => setOpen(false)}>Done</button>
          </div>
          <p className="tiny text-muted" style={{ margin: 0 }}>
            The things you set once, usually when the job is created.
          </p>

          <button type="button" className="home-row" style={{ textAlign: "left", width: "100%" }}
            disabled={!!busy} onClick={() => pick.current?.click()}>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{busy || (own ? "Change the photo" : "Give it its own photo")}</span>
              <span className="m" style={{ display: "block" }}>
                {own ? "The face on the board and on this screen"
                  : stock ? "It is wearing the standard photo for this kind of job"
                  : "It is wearing the house's photo right now"}
              </span>
            </span>
            <ChevronIcon />
          </button>

          <Link href={`/project/${projectId}/scope`} className="home-row">
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{scopeLines === 0 ? "Write the scope" : `Scope · ${scopeLines} line${scopeLines === 1 ? "" : "s"}`}</span>
              <span className="m" style={{ display: "block" }}>
                {scopeLines === 0
                  ? "Trades, their blueprint lines, then the bid packages"
                  : `${scopeTrades} trade${scopeTrades === 1 ? "" : "s"} on this job`}
              </span>
            </span>
            <ChevronIcon />
          </Link>

          {/* How it ends. Last, because it is the one thing here you do once
              and cannot take back. */}
          {lifecycle && (
            <div className="stack" style={{ gap: 8, marginTop: 4 }}>
              <div className="divider-label">How this job ends</div>
              {lifecycle}
            </div>
          )}
        </div>
      )}

      {input}
    </div>
  );
}

const GearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
