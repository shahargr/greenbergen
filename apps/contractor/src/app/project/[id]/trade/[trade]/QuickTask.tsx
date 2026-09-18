"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";
import { Evidence, type Attached } from "@shared/Evidence";
import { ChevronIcon } from "@shared/ui";
import { GateMark } from "@/components/GateMark";

// TWO KINDS OF WRITING-DOWN, AND THEY ARE NOT THE SAME ACT.
//
// Shahar (2026-09-15): "you need to be able to either do like a subtask, which
// is simple, versus the new task, which is a big one with all the different
// steps... Simple task is task that you cannot have any child to, for example.
// It inherits the trade and all that information, so it's kind of
// pre-populated. A complex task is when you have it all."
//
// "Call the framer about the landing" is a note to yourself. "Internal stairs"
// is a package of work with a scope, a contract, a payee and four steps.
// Making the first cost the second's three passes is how a thought that took
// four seconds to have stops being written down at all.
//
// So: a line and a button, here, where you are already looking at the trade.
// It stays put and clears itself, because the reason you are in this box is
// that you thought of three things at once. The wizard is one tap away for
// the other kind, and says which kind it is.
//
// FOLDED UNTIL WANTED, WITH THE PROOF BUTTONS INSIDE. Shahar (2026-09-16):
// "the log a task panel should not be open by default, only when opening it.
// on desktop it should also allow to upload evidence with drag/drop. in
// addition, all interfaces should be able to attach or take photo, record
// voice, and write note." The box was the tallest thing on a trade screen
// you open to READ - open work, late work, who is here - and it was a box
// for writing. One row now, and inside it the same three-across proof row
// every other writing surface has (Evidence): drop / attach / voice at a
// desk, photo / file / voice on a phone. The line you type is the note.
export function QuickTask({ projectId, projectName, trade, elsewhere, methods = [], accounts = [] }: {
  /** The job the task lands on - a property holds no work, its jobs do. */
  projectId: string;
  projectName: string | null;
  trade: string;
  /** Said only when the job is not the one whose screen this is. */
  elsewhere: boolean;
  /** THE RAILS MONEY CAN BE LOGGED ON (189). Active and settled by hand -
   *  a processor method is collected in the app, not written down here. No
   *  methods means no payment fold: the box stays what it was. */
  methods?: { id: string; name: string; requires_reference: boolean }[];
  /** Accounts this job has already been paid from; the list fills itself. */
  accounts?: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  // "this must come first for the rest to resume" (Shahar, 2026-09-16)
  const [gate, setGate] = useState(false);
  const [files, setFiles] = useState<Attached[]>([]);
  // Bumped after each add so the Evidence block remounts empty: its
  // attachments belong to the task just written, not the next one.
  const [round, setRound] = useState(0);
  // AND I PAID FOR IT (189). Shahar, standing on site having just handed the
  // framer a check: "When I'm logging a task for an activity I wanna be able
  // to log a payment as well." It was two screens and five steps - log the
  // task, leave, open the pay screen, pick the category, find the task you
  // just made. Folded, because most tasks are not payments.
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const [payee, setPayee] = useState("");
  const [account, setAccount] = useState("");
  const [reference, setReference] = useState("");
  const method = methods.find((m) => m.id === methodId);
  const needsRef = !!method?.requires_reference;
  const money = Number(amount.replace(/[$,\s]/g, ""));

  // WHAT IS STILL MISSING, IN WORDS. A disabled button that will not say why
  // is the worst thing you can hand somebody standing in a driveway: Shahar
  // filled five fields, pressed it, nothing happened, and read that as "error
  // saving the payment". There was no error - Check needs a reference, and
  // nothing on the screen said so. Now the button is never silent.
  const missing: string[] = [];
  if (name.trim().length === 0) missing.push("what it was");
  if (paying) {
    if (!(Number.isFinite(money) && money > 0)) missing.push("what it cost");
    if (payee.trim().length === 0) missing.push("who you paid");
    if (account.trim().length === 0) missing.push("which account it came from");
    if (needsRef && reference.trim().length === 0) {
      missing.push(`the ${(method?.name ?? "payment").toLowerCase()} reference`);
    }
  }
  const ready = missing.length === 0;

  async function add() {
    if (!ready) return;
    setBusy(true); setErr("");
    const ids = files.length > 0 ? files.map((f) => f.id) : null;
    // ONE CALL EITHER WAY. With money it is portal_task_quick_paid, which
    // makes the task and logs the payment together and removes the task
    // again if the payment is refused - so a rejected amount never leaves a
    // stray task behind for you to trip over on the retry.
    const { data, error } = paying
      ? await createClient().rpc("portal_task_quick_paid", {
          p_project: projectId,
          p_action: name.trim(),
          p_amount: money,
          p_method: methodId,
          p_trade: trade,
          p_target_date: due || null,
          p_file_ids: ids,
          p_payee_name: payee.trim(),
          p_from_account: account.trim(),
          p_reference: reference.trim() || null,
          // The proof is the receipt when this is a payment: the same files,
          // filed against the money as well as the task.
          p_receipt_ids: ids,
        })
      : await createClient().rpc("portal_task_quick", {
          p_project: projectId,
          p_action: name.trim(),
          p_trade: trade,
          p_target_date: due || null,
          p_is_gate: gate,
          p_file_ids: ids,
        });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That was not added."); return; }
    setAdded((list) => [...list, data.action as string]);
    setName(""); setDue(""); setGate(false); setFiles([]); setRound((n) => n + 1);
    // The payee and the account are the two you type again and again on a
    // run of receipts, so they stay; the amount and the reference never do.
    setAmount(""); setReference("");
    router.refresh();
  }

  return (
    <details className="home-panel">
      <summary className="home-row">
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t">Log a {trade.toLowerCase()} task</span>
          <span className="m" style={{ display: "block" }}>
            One line, a date if you know it, a photo or a voice note if you have one
          </span>
        </span>
        <span className="chev"><ChevronIcon /></span>
      </summary>

      <div className="drawer stack" style={{ gap: 8, paddingTop: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <input className="input grow" style={{ minWidth: 0 }} value={name} maxLength={300}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && ready && !busy) { e.preventDefault(); void add(); } }}
            placeholder={`Call the framer about the landing`} aria-label={`A ${trade.toLowerCase()} task`} />
          <button type="button" className="btn btn-primary" style={{ flex: "none", minHeight: 44 }}
            disabled={!ready || busy} onClick={() => { void add(); }}>
            {busy ? "…" : paying ? "Add & pay" : "Add"}
          </button>
        </div>

        {/* Never a mute button. If it will not go, this is why - and it names
            the field rather than saying "check the form". */}
        {missing.length > 0 && name.trim().length > 0 && (
          <p className="tiny qt-missing" style={{ margin: 0 }}>
            Still needs {missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`}.
          </p>
        )}

        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)}
            aria-label="When it is due" style={{ maxWidth: 190 }} />
          <span className="tiny text-muted">When, if you know.</span>
        </div>

        {/* THE PROOF, THE SAME WAY EVERYWHERE. Uploads as it goes; the ids ride
            along with the line when Add is pressed, and the database links them
            to the task (migration 145). */}
        <Evidence key={round} projectId={projectId} caption={`${trade} task`} onChange={setFiles} />

        {/* AND I PAID FOR IT (189). Shahar, 2026-09-18: "When I'm logging a
            task for an activity I wanna be able to log a payment as well."

            The kinds of task were built (action_types, seven of them, two
            carrying needs_money) and the ledger write was built
            (task_payment_log). Nobody had joined them: a payment meant
            logging the task here, leaving, opening the pay screen, choosing
            the category and finding the task you had just made.

            Folded, because most tasks are not payments. Open it and the line
            you typed becomes a financial transaction with the money already
            against it - one act, and the database undoes the whole thing if
            the payment is refused. */}
        {methods.length > 0 && (
          <>
            <label className="gate-tick">
              <input type="checkbox" checked={paying}
                onChange={(e) => { setPaying(e.target.checked); if (e.target.checked) setGate(false); }} />
              <span className="grow">
                <span className="t">…and I paid for it</span>
                <span className="m">
                  Logs the money against this task as you write it down. The photo above becomes the receipt.
                </span>
              </span>
            </label>

            {paying && (
              <div className="stack qt-pay" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <label className="nb-fld" style={{ flex: "1 1 120px" }}>
                    <span>What it cost</span>
                    <input className="input" inputMode="decimal" value={amount} placeholder="$"
                      onChange={(e) => setAmount(e.target.value)} />
                  </label>
                  <label className="nb-fld" style={{ flex: "1 1 140px" }}>
                    <span>How you paid</span>
                    <select className="input" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                      {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <label className="nb-fld" style={{ flex: "1 1 140px" }}>
                    <span>Who you paid</span>
                    <input className="input" value={payee} placeholder="Javier Rivera"
                      onChange={(e) => setPayee(e.target.value)} />
                  </label>
                  {/* BOTH ENDS OF THE MONEY, because one end is a number
                      nobody can reconcile later. The list is what this job has
                      already been paid from, and it fills itself. */}
                  <label className="nb-fld" style={{ flex: "1 1 140px" }}>
                    <span>From which account</span>
                    <input className="input" value={account} placeholder="Operating" list="qt-accounts"
                      onChange={(e) => setAccount(e.target.value)} />
                    <datalist id="qt-accounts">
                      {accounts.map((a) => <option key={a} value={a} />)}
                    </datalist>
                  </label>
                </div>
                {/* A method that cannot be reconciled without a reference says
                    so on the field, not only when the button refuses to move. */}
                {needsRef && (
                  <label className="nb-fld">
                    <span>{method?.name} reference — needed</span>
                    <input className="input" value={reference} placeholder="Check number, confirmation"
                      required aria-required
                      onChange={(e) => setReference(e.target.value)} />
                  </label>
                )}
                <p className="tiny text-muted" style={{ margin: 0 }}>
                  It lands as a financial transaction on <strong>{trade}</strong>, with the payment against it.
                  Everything else about the money — the date, a credit coming back, more receipts — is on the task
                  afterwards.
                </p>
              </div>
            )}
          </>
        )}

        {/* A GATE, IN ONE TICK RATHER THAN FOUR VISITS.
            Shahar (2026-09-16): "allow me to check a box stating this must come
            first for the rest to resume, with high priority. so this task become
            a gate in a way."

            Real dependencies exist (migration 130: after, before, parent) and
            almost nobody will ever use them, because saying "this blocks those
            four" means opening four tasks and pointing each one back here. This
            says the same thing in one tick: everything in this trade waits on
            me. High priority comes with it rather than being a second decision -
            a thing the rest of the job is waiting on IS the urgent one. */}
        <label className="gate-tick" style={paying ? { opacity: 0.45 } : undefined}>
          <input type="checkbox" checked={gate} disabled={paying}
            onChange={(e) => setGate(e.target.checked)} />
          <span className="grow">
            <span className="t">This must come first</span>
            <span className="m">
              Nothing else in {trade.toLowerCase()} moves until it is done. Logged as a gate, high priority.
            </span>
          </span>
          {gate && <GateMark label={false} />}
        </label>

        <p className="tiny text-muted" style={{ margin: 0 }}>
          Filed under <strong>{trade}</strong>
          {elsewhere && projectName ? <> on <strong>{projectName}</strong></> : null}
          . A simple task: one line, no steps under it.{" "}
          {/* THE OTHER KIND, named so the choice is visible rather than hidden
              behind knowing which button is which. */}
          <Link href={`/project/${projectId}/task/new?trade=${encodeURIComponent(trade)}&back=${encodeURIComponent(typeof window === "undefined" ? "/" : window.location.pathname + window.location.search)}`}
            style={{ fontWeight: 700 }}>
            Needs steps?
          </Link>{" "}
          is for work with a scope, a contract and a price.
        </p>

        {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
        {added.length > 0 && (
          <p className="tiny" style={{ color: "var(--color-ok)", margin: 0 }}>
            Added {added.length === 1 ? <>“{added[0]}”</> : `${added.length} tasks`}. Keep going — it stays open.
          </p>
        )}
      </div>
    </details>
  );
}
