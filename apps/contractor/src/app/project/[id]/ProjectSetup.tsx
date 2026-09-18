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
// THE PHOTO IS GONE FROM THIS SCREEN. Shahar (2026-09-15): "Remove the photo
// to reduce traffic." It was a signed storage URL fetched on every open of
// every project, 150px tall, to say what the type icon now says for nothing.
// Changing it still lives HERE, behind the gear, because that is where the
// things you set once belong - the screen simply no longer shows the result.
//
// And the gear itself has left this component (Shahar, same message: "Place
// the gear button next to the Project name"). It is a link in the app bar.
//
// IT IS A SCREEN NOW, not a panel on top of the running one (Shahar,
// 2026-09-18: "when inside a project, the gear button should move us into a
// new setting page rather than add a panel"). The gear navigates to
// /project/<id>/setup, the app bar's back arrow is the way out, and this
// component is simply what that page renders - so `open` and the "Done" link
// that stood in for a back button are both gone.
export function ProjectSetup({ projectId, own, stock, canEdit, scopeLines, scopeTrades, lifecycle, sale }: {
  projectId: string; own: boolean; stock: boolean; canEdit: boolean;
  scopeLines: number; scopeTrades: number; lifecycle?: React.ReactNode;
  /** WHEN THIS HOUSE SELLS (migration 162): the two planned days, offered
   *  only on a property - the loans beneath count backwards from them. */
  sale?: { good: string | null; bad: string | null } | null;
}) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [good, setGood] = useState(sale?.good ?? "");
  const [bad, setBad] = useState(sale?.bad ?? "");
  const [saleMsg, setSaleMsg] = useState("");
  const saleDirty = (sale?.good ?? "") !== good || (sale?.bad ?? "") !== bad;

  // Shahar (2026-09-17): "till I plan to sell so we can calculate backwards.
  // End date should have good and bad scenario." Saved here, on the house;
  // the database re-runs every loan's schedule beneath it (trigger).
  async function saveSale() {
    setErr(""); setSaleMsg(""); setBusy("Saving…");
    const { data, error } = await createClient().rpc("portal_project_sale_targets", {
      p_project: projectId, p_good: good || null, p_bad: bad || null,
    });
    setBusy("");
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That did not save."); return; }
    setSaleMsg("Saved. The loans on this house now count to these days.");
    router.refresh();
  }

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
    setErr("");
    router.refresh();
  }

  const input = (
    <input ref={pick} type="file" accept="image/*" hidden
      onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
  );

  if (!canEdit) return null;

  return (
    <div className="stack" style={{ gap: 6 }}>
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}

      {/* Set-up, not running. The heading stays even though the screen's app
          bar says "Set up" too: it names what the card holds, and the line
          under it is the one thing a person needs to know before touching
          anything here. */}
      {(
        <div className="card pad stack" style={{ gap: 8 }}>
          <span className="small" style={{ fontWeight: 700 }}>Set this project up</span>
          <p className="tiny text-muted" style={{ margin: 0 }}>
            The things you set once, usually when the job is created.
          </p>

          <button type="button" className="home-row" style={{ textAlign: "left", width: "100%" }}
            disabled={!!busy} onClick={() => pick.current?.click()}>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{busy || (own ? "Change the photo" : "Give it its own photo")}</span>
              <span className="m" style={{ display: "block" }}>
                {own ? "The face on the board"
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

          {/* WHEN THIS HOUSE SELLS. Two days, not one: the sale you plan for
              and the sale you can live with. The loan's schedule runs to the
              bad day and its card on the money screen says what each day
              costs. Only on a property; a job beneath inherits. */}
          {sale !== undefined && sale !== null && (
            <div className="stack" style={{ gap: 8, marginTop: 4 }}>
              <div className="divider-label">When this house sells</div>
              <div className="task-row-value pair">
                <label className="field" style={{ marginBottom: 0 }}>
                  <span className="field-label">Good day</span>
                  <input className="input" type="date" value={good} onChange={(e) => setGood(e.target.value)} />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  <span className="field-label">Bad day</span>
                  <input className="input" type="date" value={bad} min={good || undefined} onChange={(e) => setBad(e.target.value)} />
                </label>
              </div>
              <div className="between" style={{ gap: 8, alignItems: "center" }}>
                <span className="tiny text-muted grow" style={{ minWidth: 0 }}>
                  {saleMsg || "The loans beneath count backwards from these: payments left, cost by each day. The schedule runs to the bad day."}
                </span>
                <button type="button" className="btn btn-secondary small" style={{ minHeight: 34, flex: "none" }}
                  disabled={!saleDirty || !!busy} onClick={() => void saveSale()}>
                  {saleDirty ? "Save the days" : "Saved"}
                </button>
              </div>
            </div>
          )}

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
