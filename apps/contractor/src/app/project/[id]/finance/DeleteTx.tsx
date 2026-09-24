"use client";

import { useTransition } from "react";

// The ledger's trash can. A payment is money history, so the click asks in
// words before the strike-out; the RPC (230) writes what it was to
// change_events before the row goes.
export function DeleteTx({ what, act }: { what: string; act: () => Promise<void> }) {
  const [busy, start] = useTransition();
  return (
    <button type="button" className="btn btn-ghost" disabled={busy}
      title="Remove this payment from the ledger"
      style={{ padding: "3px 6px", color: "var(--color-danger)" }}
      onClick={() => {
        if (!window.confirm(`Remove ${what} from the ledger? Its receipts stay in the project's files.`)) return;
        start(() => act());
      }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden width={14} height={14}>
        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}
