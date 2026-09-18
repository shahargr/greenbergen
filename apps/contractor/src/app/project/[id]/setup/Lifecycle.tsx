import { Card, ChevronIcon } from "@shared/ui";
import { money } from "@/lib/board";
import { archiveProject, cancelProject, closeProject, reopenProject } from "../actions";

// HOW THIS JOB ENDS (migrations 069, 070), behind the gear.
//
// Shahar first: "The scope was complete / no place to close it as complete
// from inside?" - there was not; the only door was the portal's Setup tab.
// Then: "move the cancel this job into the setting of it" - so both endings
// sit with the other things you do to a job rather than to the work on it.
//
// The rules are the database's and they are old: complete needs zero open
// tasks anywhere in the family and no live job beneath it; cancelled needs a
// reason and takes the open work down with it; both FREEZE the record. So
// this says which of those is in the way rather than offering a button that
// will be refused.
export function Lifecycle({ projectId, status, closed, owns, archived, open, liveKids, owed, paid, superadmin }: {
  projectId: string; status: string; closed: boolean;
  // The asset owner (rank 70). Ending a job and deciding what stays on the
  // board are theirs; running it day to day is not the same authority.
  owns: boolean; archived: boolean;
  open: number; liveKids: number; owed: number; paid: number; superadmin: boolean;
}) {
  if (closed) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <Card soft pad>
          <div className="small">
            This job is {status.replace("Closed - ", "").toLowerCase()}. Its tasks, contracts and
            payments are frozen — work that comes back belongs in a new job beneath the property.
          </div>
        </Card>

        {/* PUTTING IT AWAY (migration 115). The ending froze the record; this
            only decides whether the owner keeps looking at it. Nothing is
            deleted and the same button brings it back. */}
        {owns && (
          <form action={archiveProject.bind(null, projectId, !archived)}>
            <button className="btn btn-secondary btn-block">
              {archived ? "Bring it back onto the board" : "Put this job away"}
            </button>
            <p className="tiny text-muted" style={{ margin: "6px 0 0", textAlign: "center" }}>
              {archived
                ? "It is off your board. Nothing was deleted."
                : "It comes off your board. Nothing is deleted, and this button brings it back."}
            </p>
          </form>
        )}
        {superadmin && (
          <details className="home-panel">
            <summary className="home-row">
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">Reopen it</span>
                <span className="m" style={{ display: "block" }}>Superadmin only — it unfreezes everything</span>
              </span>
              <span className="chev"><ChevronIcon /></span>
            </summary>
            <form action={reopenProject.bind(null, projectId)} className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Why it is opening again</span>
                <input className="input" name="reason" placeholder="The motor failed again · a bill arrived late" />
              </label>
              <button className="btn btn-secondary btn-block">Reopen this job</button>
            </form>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <details className="home-panel">
        <summary className="home-row">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">Finish this job</span>
            <span className="m" style={{ display: "block" }}>
              {open > 0 ? `${open} ${open === 1 ? "task is" : "tasks are"} still open`
                : liveKids > 0 ? `${liveKids} ${liveKids === 1 ? "job beneath it is" : "jobs beneath it are"} still open`
                : "Nothing is open — it can close as complete"}
            </span>
          </span>
          <span className="chev"><ChevronIcon /></span>
        </summary>
        <div className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
          {open > 0 ? (
            <p className="small text-muted" style={{ margin: 0 }}>
              A job closes as complete only when there is nothing left on it — finish or cancel
              {open === 1 ? " that task" : " those tasks"} and this turns into a button.
            </p>
          ) : liveKids > 0 ? (
            <p className="small text-muted" style={{ margin: 0 }}>
              Close {liveKids === 1 ? "the job" : "the jobs"} beneath this one first.
            </p>
          ) : (
            <form action={closeProject.bind(null, projectId)} className="stack" style={{ gap: 8 }}>
              <p className="small text-muted" style={{ margin: 0 }}>
                Closing it freezes the record — tasks, contracts and payments can no longer be
                written — and sends the surveys.
              </p>
              {owed > 0 && (
                <p className="tiny" style={{ color: "var(--color-status)", margin: 0 }}>
                  {money(owed)} is still outstanding. That does not stop you — a finished job with a
                  bill left to pay is normal — but the ledger keeps it after the freeze.
                </p>
              )}
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">How it ended <span className="text-muted">(optional)</span></span>
                <input className="input" name="note" placeholder="Shade fixed and tested, homeowner happy" />
              </label>
              <button className="btn btn-primary btn-block">Close this job as complete</button>
            </form>
          )}
        </div>
      </details>

      {/* THE OTHER ENDING (migration 070). Greyed out for everybody on
          2026-09-13 - "this is too risky" - and back on 2026-09-14 for the
          person who owns the job: "as the owner of a project, I need to be
          able to cancel and archive it."

          It is still the heaviest button on the screen: it ends the work and
          takes every open task down with it. So it stays folded, it asks for
          a reason in the person's own words (the database refuses fewer than
          four characters), and it says the count out loud before the press.
          Below rank 70 the row stays greyed and says whose call it is. */}
      {owns ? (
        <details className="home-panel">
          <summary className="home-row">
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">Cancel this job</span>
              <span className="m" style={{ display: "block" }}>
                It will not happen — this ends it and takes
                {open > 0 ? ` ${open} open ${open === 1 ? "task" : "tasks"}` : " anything open"} with it
              </span>
            </span>
            <span className="chev"><ChevronIcon /></span>
          </summary>
          <form action={cancelProject.bind(null, projectId)} className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
            <p className="small text-muted" style={{ margin: 0 }}>
              Everything still open here is cancelled with it and the record freezes — the reason
              you give is written onto the job and onto every task that goes with it.
            </p>
            {paid > 0 && (
              <p className="tiny" style={{ color: "var(--color-status)", margin: 0 }}>
                {money(paid)} has already been paid on this one. Cancelling does not unspend it; the
                ledger keeps it.
              </p>
            )}
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">Why it is being cancelled</span>
              <input className="input" name="reason" required minLength={4}
                placeholder="Duplicate of the other generator job · homeowner changed their mind" />
            </label>
            <button className="btn btn-secondary btn-block">Cancel this job</button>
          </form>
        </details>
      ) : (
        <div className="home-row" aria-disabled="true"
          style={{ cursor: "not-allowed", opacity: 0.45, alignItems: "flex-start" }}>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">Cancel this job</span>
            <span className="m" style={{ display: "block" }}>
              The owner&apos;s call — it would end the work and take
              {open > 0 ? ` ${open} open ${open === 1 ? "task" : "tasks"}` : " anything open"} with it
            </span>
          </span>
        </div>
      )}
      <p className="tiny text-muted" style={{ margin: 0 }}>
        Either ending freezes the record. Once it has ended you can put it away, which takes it off
        your board without deleting anything.
        {paid > 0 ? ` ${money(paid)} has already been paid on this one.` : ""}
      </p>
    </div>
  );
}
