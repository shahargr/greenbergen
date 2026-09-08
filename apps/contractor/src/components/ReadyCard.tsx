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

  return (
    <Card pad>
      <div className="card-title" style={{ fontSize: 16 }}>
        {left.length === 0 ? "Ready to send" : left.length === 1 ? "One thing left" : `${left.length} things left`}
      </div>
      <p className="small text-muted" style={{ margin: "2px 0 10px" }}>
        Look at the work all you like. These are what we need before you can accept a job — the community is built on them.
      </p>
      <div className="stack" style={{ gap: 6 }}>
        {left.map((o) => (
          <Link key={o.key} href={o.href} className="home-row">
            <span className="grow"><span className="t">{o.label}</span></span>
            <ChevronIcon />
          </Link>
        ))}
      </div>
      {left.length === 0 && <Link href="/business/submit" className="btn btn-primary btn-block" style={{ marginTop: 10 }}>Send for approval</Link>}
    </Card>
  );
}
