import { Card, Notice } from "../ui";
import { askedText, type OfferQuestion } from "./questions";
import { answerQuestion, declineQuestion } from "./actions";

// QUESTIONS WAITING ON YOU, on the homeowner's side.
//
// A contractor wants your job but will not stand behind the price until they
// know something. This is the most important card that can appear in a
// homeowner's inbox: an unanswered one is a job standing still, and the
// person asking is the one who would do the work.
//
// It shows only what is WAITING (state "asked"). Once you answer, the
// conversation is ordinary messages in the same inbox further down - there is
// no second place to look, and no thread to render twice.
export function OfferQuestions({ questions, base }: { questions: OfferQuestion[]; base: string }) {
  const waiting = questions.filter((q) => !q.mine && q.state === "asked");
  if (waiting.length === 0) return null;

  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="divider-label">
        {waiting.length === 1 ? "A question before someone accepts" : `${waiting.length} questions before someone accepts`}
      </div>
      {waiting.map((q) => (
        <Card pad key={q.action_id}>
          <div className="card-title" style={{ fontSize: 15 }}>{q.asked_by ?? "A contractor"} asked about {q.package ?? "your job"}</div>
          <p className="small" style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{askedText(q)}</p>

          <p className="tiny text-muted" style={{ margin: "10px 0 0" }}>
            They have <strong>not</strong> accepted and the price is not agreed — this is a question, not a bid.
            Your address is still withheld; answering does not release it.
          </p>

          <form action={answerQuestion} className="stack" style={{ gap: 8, marginTop: 10 }}>
            <input type="hidden" name="base" value={base} />
            <input type="hidden" name="action" value={q.action_id} />
            <textarea className="input" name="reply" rows={3} required
                      placeholder="About 18 feet, same side of the house." />
            <button className="btn btn-primary btn-block">Answer them</button>
          </form>

          {/* Declining is still an answer - they get told - so it sits here
              rather than being a silent way to ignore someone. */}
          <details style={{ marginTop: 8 }}>
            <summary className="tiny text-muted" style={{ cursor: "pointer" }}>Rather not say before someone accepts</summary>
            <form action={declineQuestion} className="stack" style={{ gap: 8, marginTop: 8 }}>
              <input type="hidden" name="base" value={base} />
              <input type="hidden" name="action" value={q.action_id} />
              <input className="input" name="reply" placeholder="A line back to them (optional)" />
              <button className="btn btn-ghost btn-block">Decline the question</button>
            </form>
          </details>
        </Card>
      ))}
      <Notice>
        Answering opens a thread about <strong>this job only</strong>. It does not seat them, does not agree the price,
        and does not release your address — that happens when someone accepts.
      </Notice>
    </section>
  );
}
