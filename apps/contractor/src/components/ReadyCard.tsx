import Link from "next/link";
import { Card, ChevronIcon } from "@shared/ui";
import type { Me } from "@/lib/me";
import { outstanding } from "@/lib/me";

// The honest status card. A contractor should never wonder why a button is
// grey: this says what is on file, what is not, and who is waiting on whom.
export function ReadyCard({ me }: { me: Extract<Me, { signed_in: true }> }) {
  const left = outstanding(me);
  const status = me.approval.status;

  if (me.can_accept) {
    return (
      <Card pad>
        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <span className="tag tag-ok">Approved</span>
          <span className="small text-muted">You can take work at the community price.</span>
        </div>
      </Card>
    );
  }

  if (status === "submitted" && left.length === 0) {
    return (
      <Card pad>
        <div className="card-title" style={{ fontSize: 16 }}>With Green Bergen for review</div>
        <p className="small text-muted" style={{ margin: "2px 0 0" }}>
          Everything is on file. A person here checks your licence and certificates — usually within one business day.
          Browse the work meanwhile; you just can&apos;t accept until this clears.
        </p>
      </Card>
    );
  }

  if (status === "more needed") {
    return (
      <Card pad>
        <div className="row" style={{ alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span className="tag tag-status">More needed</span>
        </div>
        <p className="small" style={{ margin: 0 }}>{me.approval.reason ?? "We need another look at your documents."}</p>
        <Link href="/business/documents" className="btn btn-primary btn-block" style={{ marginTop: 10 }}>Fix it</Link>
      </Card>
    );
  }

  // SHUT BY DEFAULT. This is a to-do list about paperwork, and paperwork is
  // never why someone opened the app - the work is. Four rows of it at the
  // top of the landing pushed the actual properties below the fold. It says
  // how many are left in one line and opens on a tap.
  return (
    <details className="home-panel">
      <summary className="home-row">
        <span className="ic" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 3h7l4 4v14H7zM14 3v4h4M9 13h6M9 17h4" />
          </svg>
        </span>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t">
            {left.length === 0 ? "Ready to send" : left.length === 1 ? "One thing left" : `${left.length} things left`}
          </span>
          <span className="m" style={{ display: "block" }}>
            {left.length === 0
              ? "Everything is on file."
              : "What we need before you can accept a job."}
          </span>
        </span>
        <span className="chev"><ChevronIcon /></span>
      </summary>
      <div className="drawer stack" style={{ gap: 6, paddingTop: 12 }}>
        <p className="tiny text-muted" style={{ margin: "0 0 2px" }}>
          Look at the work all you like — the community is built on these.
        </p>
        {left.map((o) => (
          <Link key={o.key} href={o.href} className="home-row" style={{ boxShadow: "var(--shadow-card)", background: "var(--color-surface)", borderRadius: "var(--radius-tile)" }}>
            <span className="grow"><span className="t">{o.label}</span></span>
            <ChevronIcon />
          </Link>
        ))}
        {left.length === 0 && <Link href="/business/submit" className="btn btn-primary btn-block">Send for approval</Link>}
      </div>
    </details>
  );
}
