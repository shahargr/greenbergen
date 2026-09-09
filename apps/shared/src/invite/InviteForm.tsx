import Link from "next/link";
import { Card } from "../ui";
import { CopyLink } from "./CopyLink";
import { invitePerson } from "./actions";
import { SITE_ORIGIN } from "../site";

// ONE INVITATION FORM, EVERY DOOR.
//
// Two choices is a toggle, not a dropdown: both are visible, it is one tap
// instead of two, and on a phone it does not open a picker sheet over the
// form. Every field under it is optional, as Shahar specified - leave them
// all blank and you simply get a link to pass on yourself.
//
// When a link has just been made (`token` on the URL), the form is replaced
// by the link and a way back to making another, because the next thing the
// person does is copy it, not fill the form in again.
export function InviteForm({
  base, token, who, kind, heading = "Invite someone to Green Bergen",
}: {
  base: string;                       // this door's page, for the redirect
  token?: string; who?: string; kind?: string;
  heading?: string | null;            // null hides the divider label
}) {
  const link = token ? `${SITE_ORIGIN}/join?invite=${encodeURIComponent(token)}` : null;

  return (
    <section className="stack" style={{ gap: 10 }}>
      {heading && <div className="divider-label">{heading}</div>}
      {link ? (
        <Card pad>
          <div className="card-title" style={{ fontSize: 15 }}>A link for {who ?? "them"}</div>
          <p className="small text-muted" style={{ margin: "2px 0 10px" }}>
            Send it however you like — text, email, in person. It brings them in as{" "}
            {kind === "contractor" ? "a contractor" : "a homeowner with their own home"}. Nobody joins until they open it.
          </p>
          <CopyLink link={link} />
          <p className="tiny text-muted" style={{ marginTop: 10 }}><Link href={base}>Make another</Link></p>
        </Card>
      ) : (
        <Card pad>
          <form action={invitePerson} className="stack" style={{ gap: 10 }}>
            <input type="hidden" name="base" value={base} />
            <div className="field">
              <span className="field-label">Who is it?</span>
              <div className="seg" role="radiogroup" aria-label="Who is it?">
                <label className="seg-opt">
                  <input type="radio" name="kind" value="homeowner" defaultChecked />
                  <span>A homeowner</span>
                </label>
                <label className="seg-opt">
                  <input type="radio" name="kind" value="contractor" />
                  <span>A contractor</span>
                </label>
              </div>
              <p className="hint">A homeowner gets their own home and jobs; a contractor takes work at the community price.</p>
            </div>
            <label className="field">
              <span className="field-label">Their name <span className="text-muted">(optional)</span></span>
              <input className="input" name="name" placeholder="Dana from two doors down" />
            </label>
            <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <label className="field grow">
                <span className="field-label">Phone <span className="text-muted">(optional)</span></span>
                <input className="input" name="phone" type="tel" inputMode="tel" placeholder="(201) 555-0100" />
              </label>
              <label className="field grow">
                <span className="field-label">Email <span className="text-muted">(optional)</span></span>
                <input className="input" name="email" type="email" inputMode="email" placeholder="dana@example.com" />
              </label>
            </div>
            <label className="field">
              <span className="field-label">A line from you <span className="text-muted">(optional)</span></span>
              <input className="input" name="note" placeholder="This is the group we used for the water heater." />
              <p className="hint">Leave everything blank and you just get a link to pass on yourself.</p>
            </label>
            <button className="btn btn-primary btn-block">Make the invitation</button>
          </form>
        </Card>
      )}
    </section>
  );
}
