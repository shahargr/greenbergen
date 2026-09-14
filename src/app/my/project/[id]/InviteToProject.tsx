import Link from "next/link";
import { inviteToProject } from "../../invite/actions";

// INVITING SOMEBODY ONTO A PROJECT.
//
// Shahar (2026-09-14), acting as a homeowner on his generator job: "i'm
// looking for a way to invite a contractor into this job, and i cannot find
// it." It was on the Setup tab, folded shut, next to the delete zone - the
// last place you look when the question is "who else should be on this".
// So the form now stands in two places, and this is the one copy of it: on
// Setup where it always was, and in the People panel on Tasks, which is
// where he went looking.
//
// The name box is not decoration. portal_invite_to_project refuses an email
// it does not recognise unless a name comes with it - "Add their name and
// they will be invited as a newcomer" - and until now the form had nowhere
// to put one, so inviting anybody who is not already on Green Bergen ended
// in a refusal that could not be answered.
export function InviteToProject({
  projectId,
  projectName,
  isHome,
  back,
  idPrefix,
  open = false,
}: {
  projectId: string;
  projectName: string;
  isHome: boolean;
  /** Portal path to return to; the action appends ok / error / a join link. */
  back: string;
  /** Two copies of this form on one page - the labels need distinct ids. */
  idPrefix: string;
  open?: boolean;
}) {
  return (
    <details className="card" open={open} style={{ display: "grid", gap: 8 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>
        ➕ Invite someone to this {isHome ? "home" : "project"}
      </summary>
      <form action={inviteToProject} style={{ display: "grid", gap: 8, marginTop: 8 }}>
        <input type="hidden" name="project" value={projectId} />
        <input type="hidden" name="back" value={back} />
        <div className="form-2col">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`${idPrefix}-inv-contact`}>Their email or phone</label>
            <input id={`${idPrefix}-inv-contact`} name="contact" className="input" required autoComplete="off"
              placeholder="name@example.com or 201-555-0100" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`${idPrefix}-inv-name`}>Their name</label>
            <input id={`${idPrefix}-inv-name`} name="name" className="input" autoComplete="off" placeholder="Volt &amp; Sons" />
          </div>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          The name is only needed if they are not on Green Bergen yet — then you get a join link to send them.
        </p>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor={`${idPrefix}-inv-note`}>Note (optional)</label>
          <input id={`${idPrefix}-inv-note`} name="note" className="input" defaultValue={`Please join ${projectName} to assist with `} />
        </div>
        <div className="radio-row" style={{ minHeight: 0 }}>
          <label className="radio-opt"><input type="radio" name="seat" value="contractor" defaultChecked /> Contractor</label>
          <label className="radio-opt"><input type="radio" name="seat" value="viewer" /> Viewer</label>
          <label className="radio-opt"><input type="radio" name="seat" value="resident" /> Co-owner</label>
        </div>
        <div className="btn-row" style={{ alignItems: "center" }}>
          <button className="btn small">Invite user</button>
          <Link href={`/my/invite?project=${projectId}`} className="small muted">See every invitation you have sent →</Link>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Nobody is seated by this. They accept or decline on their next login, and the answer shows on your home page.
        </p>
      </form>
    </details>
  );
}
