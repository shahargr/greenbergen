"use client";

import { useMemo, useState } from "react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { logPayment } from "./actions";

export type PayProject = { id: string; name: string };
export type PayMember = { projectId: string; contactId: string; name: string; canPay: boolean };
export type PayContract = { id: string; title: string; projectId: string };
export type PayMethod = { id: string; name: string };

// The payment screen: everything below the project select follows it -
// payers and requested-by come from that project's members, contracts from
// that project only. Receipts (photos) and a voice note ride along.
export function LogPaymentForm({
  projects,
  members,
  contracts,
  methods,
  meName,
}: {
  projects: PayProject[];
  members: PayMember[];
  contracts: PayContract[];
  methods: PayMethod[];
  meName: string;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);

  const payers = useMemo(() => {
    const list = members.filter((m) => m.projectId === projectId && m.canPay).map((m) => m.name);
    if (meName && !list.includes(meName)) list.unshift(meName);
    return [...new Set(list)];
  }, [members, projectId, meName]);

  const people = useMemo(
    () => members.filter((m) => m.projectId === projectId),
    [members, projectId]
  );
  const projectContracts = useMemo(
    () => contracts.filter((c) => c.projectId === projectId),
    [contracts, projectId]
  );

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (voiceBlob) {
      const ext = voiceBlob.type.includes("mp4") ? "m4a" : "webm";
      fd.append("files", new File([voiceBlob], `payment-note.${ext}`, { type: voiceBlob.type }));
    }
    setBusy(true);
    await logPayment(fd);
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 10, maxWidth: 480 }}>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pay-project">Project</label>
          <select id="pay-project" name="project" className="input" required
            value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pay-amount">Amount ($)</label>
          <input id="pay-amount" name="amount" className="input" inputMode="decimal" required placeholder="2,500" />
        </div>
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pay-by">Paid by</label>
          <select id="pay-by" name="paid_by" className="input" defaultValue={meName}>
            {payers.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pay-on">Paid on</label>
          <input id="pay-on" name="paid_on" type="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="pay-to">Paid to</label>
        <input id="pay-to" name="paid_to" className="input" required placeholder="Who received the money" />
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pay-from">Paid from (account)</label>
          <input id="pay-from" name="paid_from" className="input" placeholder="e.g. Chase LLC checking" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pay-method">Payment type</label>
          <select id="pay-method" name="method" className="input" required>
            {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pay-req">Requested by (optional)</label>
          <select id="pay-req" name="requested_by" className="input" defaultValue="">
            <option value="">—</option>
            {people.map((m) => <option key={m.contactId} value={m.contactId}>{m.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pay-contract">Contract (optional)</label>
          <select id="pay-contract" name="contract" className="input" defaultValue="">
            <option value="">—</option>
            {projectContracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="pay-notes">Notes (optional)</label>
        <input id="pay-notes" name="notes" className="input" placeholder="What was this for?" />
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Receipt photos (optional)</label>
          <input type="file" name="photos" accept="image/*" capture="environment" multiple className="small" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Voice note (optional)</label>
          <VoiceRecorder onReady={setVoiceBlob} />
        </div>
      </div>
      <div>
        <button className="btn" disabled={busy}>{busy ? "Logging..." : "Log payment"}</button>
      </div>
    </form>
  );
}
