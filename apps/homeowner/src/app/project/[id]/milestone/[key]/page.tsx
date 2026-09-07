import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getBooking } from "@/lib/booking";
import { dollars, shortDate } from "@shared/format";
import { AppBar, Blueprint, Notice, Screen, StatusHero } from "@shared/ui";
import { MilestoneForm } from "./MilestoneForm";
import { closeTask } from "../../actions";

export const dynamic = "force-dynamic";

// Screen 15 - milestone confirmation and the payment trigger. Marking logs
// it for both parties and moves the line; money goes to the contractor
// directly (card is not wired yet and says so; check or cash is
// photographed as evidence).
export default async function MilestonePage({ params, searchParams }: { params: Promise<{ id: string; key: string }>; searchParams: Promise<{ error?: string; done?: string; paid?: string; card?: string; logged?: string }> }) {
  const { id, key } = await params;
  const sp = await searchParams;
  const { booking: b, missing } = await getBooking(id);
  if (missing) redirect("/project");
  if (!b) notFound();
  const node = b.progress.nodes.find((n) => n.key === key);
  if (!node) notFound();
  const idx = b.progress.nodes.findIndex((n) => n.key === key) + 1;
  const first = b.contractor?.person?.split(" ")[0] ?? "the contractor";
  const cname = b.contractor?.name ?? "your contractor";
  const remaining = b.stages.filter((s) => !(s.status === "Paid" || s.settlement_status === "paid") && s.id !== node.stage_id).reduce((a, s) => a + s.amount_cents, 0);

  if (sp.done) {
    const paid = sp.paid === "1";
    return (
      <Screen>
        <AppBar brand />
        <div className="body">
          <StatusHero variant="solid" kicker={`Milestone logged · ${shortDate(new Date().toISOString())}`}
            title={node.kind === "payment" ? (paid ? `${node.name} done. ${dollars(node.amount_cents)} paid to ${first}.` : `${node.name} logged.`) : node.kind === "done" ? "Done. The job is closed." : `${node.name} — logged.`}>
            {node.kind === "payment" && paid && <>The record is in your folder. {nextStep(b, key)}</>}
            {node.kind === "payment" && !paid && sp.card === "0" && <>Card payments in the app aren&apos;t switched on yet. Pay {first} directly and photograph the check or receipt when you do — it lands in the folder.</>}
            {node.kind === "payment" && !paid && sp.card !== "0" && <>We&apos;ll remind you tomorrow to record the payment. {nextStep(b, key)}</>}
            {node.kind !== "payment" && nextStep(b, key)}
          </StatusHero>
          {node.kind === "payment" && paid && (
            <Blueprint pad={false}>
              <div className="kv-rows" style={{ padding: "4px 14px" }}>
                <div><span className="k">Paid to</span><span>{cname}</span></div>
                <div><span className="k">Amount</span><span>{dollars(node.amount_cents)}</span></div>
                <div><span className="k">Remaining</span><span>{remaining > 0 ? `${dollars(remaining)} · due at completion` : "nothing"}</span></div>
              </div>
            </Blueprint>
          )}
        </div>
        <div className="actions">
          <Link href={`/project/${id}`} className="btn btn-primary btn-block blueprint">Back to my project</Link>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar back={`/project/${id}`} />
      <div className="body">
        <div className="kicker">Milestone {idx} of {b.progress.total}</div>
        <h2>
          {node.kind === "payment" && key === "permit_meeting" && `Did you meet ${first} for the permit signing?`}
          {node.kind === "payment" && key !== "permit_meeting" && `Is the work done?`}
          {node.kind === "task" && `${node.name}?`}
          {node.kind === "done" && `Close the job?`}
          {(node.kind === "booked" || node.kind === "accepted") && node.name}
        </h2>
        <p className="small text-muted" style={{ margin: 0 }}>
          {node.kind === "done" ? "Closing freezes the job as complete. Every step on the line has to be marked and every payment recorded first." : `Marking this logs it to the folder for both of you and moves the line forward. ${first} gets a note to confirm.`}
        </p>
        {sp.error && <Notice kind="error" title={sp.logged ? "The milestone is logged, but the payment was not recorded." : "That didn't go through."}>{sp.error}</Notice>}
        {node.status === "done" && <Notice>Already marked{node.at ? ` on ${shortDate(node.at)}` : ""}.{node.kind === "payment" && node.unsettled ? " The payment is still to be recorded below." : ""}</Notice>}
        {node.kind === "done" && b.open_tasks.length > 0 && (
          <Blueprint pad={false}>
            <div style={{ padding: "10px 14px 4px" }}><div className="kicker">Still open</div></div>
            {b.open_tasks.map((t) => (
              <form key={t.id} action={closeTask} className="frow" style={{ alignItems: "flex-start" }}>
                <input type="hidden" name="project" value={id} />
                <input type="hidden" name="action_id" value={t.id} />
                <input type="hidden" name="back" value={`/project/${id}/milestone/${key}`} />
                <span className="grow">
                  <div className="t" style={{ fontSize: 14 }}>{t.kind === "payment_confirmation" ? t.action.replace(/^Awaiting confirmation from /, "Did ") .replace(/ - \$/, " confirm the $") + "?" : t.action}</div>
                  <div className="m">{t.kind === "payment_confirmation" ? "Closing this files the receipt against the payment." : t.pending_reason ?? "A step on the line."}</div>
                </span>
                <button className="btn btn-secondary">{t.kind === "payment_confirmation" ? "Yes, confirmed" : "Done"}</button>
              </form>
            ))}
          </Blueprint>
        )}
        {(node.kind === "booked" || node.kind === "accepted") ? (
          <Notice>This step marks itself{node.kind === "accepted" ? " when a contractor accepts" : ""}.</Notice>
        ) : (
          <MilestoneForm projectId={id} nodeKey={key} kind={node.kind} amountCents={node.amount_cents ?? 0} totalCents={b.price_cents} percent={node.percent_of_contract} contractor={cname} alreadyDone={node.status === "done" && !node.unsettled} />
        )}
      </div>
    </Screen>
  );
}

function nextStep(b: NonNullable<Awaited<ReturnType<typeof getBooking>>["booking"]>, key: string) {
  const i = b.progress.nodes.findIndex((n) => n.key === key);
  const next = b.progress.nodes[i + 1];
  if (!next) return "";
  return `Next: ${next.name.toLowerCase()}${next.typical_range ? ` — typically ${next.typical_range}` : ""}.`;
}
