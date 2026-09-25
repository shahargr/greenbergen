export const metadata = { title: "Payouts · Admin" };

// PAYOUTS - A PLACEHOLDER (Shahar, 2026-09-25: "if needed, build one with
// only text indicating its a place holder"). When a package is collected by
// Green Bergen, the homeowner pays upfront and Green Bergen pays the
// contractor when they accept the job (migrations 242, 243). What is owed is
// v_contractor_payouts_due; a payout is recorded with record_contractor_payout.
// This screen will list the first and record the second.
export default function AdminPayoutsPage() {
  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96 }}>
      <span className="kicker">Admin</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Payouts</h1>
      <p className="card muted small" style={{ maxWidth: 640 }}>
        Placeholder. This page will list what Green Bergen owes contractors on jobs the homeowner paid Green Bergen
        upfront, and record each payout once the contractor has accepted the job and the homeowner&apos;s payment is
        confirmed. Nothing here yet.
      </p>
    </main>
  );
}
