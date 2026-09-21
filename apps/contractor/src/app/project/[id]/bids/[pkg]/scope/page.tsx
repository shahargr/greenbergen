import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { refineLines } from "../actions";

// THE SCOPE, ONE KIND OF LINE AT A TIME.
//
// Shahar, 2026-09-21: "the scope panel should be a scope page with step by
// step guidance to complete it. from standard (include yes / no), to
// optional (include yes / no), and special - added by user (include yes /
// no)."
//
// The room had this as a fold called "Refine the lines · one at a time",
// sitting between six other folds. It showed every line of every kind in one
// undifferentiated list, so the question it actually asks - is this line
// part of what we are asking for? - had to be asked twenty times with no
// sense of progress and no idea what the twenty had in common.
//
// Three groups, because a line is one of three things and each one is a
// DIFFERENT question:
//
//   standard  did the blueprint's usual line apply to THIS job? (tear-off on
//             a new build does not)
//   optional  do we want this priced on its own line, or not at all?
//   special   somebody typed this for this job - does it still belong?
//
// SAVED AT EVERY STEP, not at the end. A wizard that holds three screens of
// ticks in the browser and posts them together loses all three to one stray
// tap. Each step posts its own group and the next step is a fresh read, so
// the worst a lost tap can cost is the step you are on.
//
// THE GROUPING IS THE DATABASE'S, NOT A GUESS (migration 216).
// bid_package_items.kind separates base from option; project_scope_items.
// origin separates a line a package seeded from one a person wrote. Both
// were already recorded - origin simply was not being selected.

type Item = {
  id: string; scope_item_id: string; item: string; category: string | null;
  is_required: boolean; kind: "base" | "option";
  is_included: boolean; excluded_why: string | null;
  origin: string | null; source: string | null;
};
type Pkg = {
  id: string; project_id: string; project_name: string | null;
  trade: string | null; category: string | null; status: string;
  awarded_bid_id: string | null; can_edit: boolean; items: Item[];
};

const STEPS = [
  {
    key: "standard",
    title: "Standard lines",
    lead: "The lines this trade normally carries. Untick the ones that do not apply to this job — a new build has nothing to tear off.",
    empty: "No standard lines. This room's scope was written by hand rather than seeded from a blueprint, so everything is under Special.",
  },
  {
    key: "optional",
    title: "Optional lines",
    lead: "Extras every bidder prices on their own line, so you can take them or leave them when the numbers come back.",
    empty: "No optional lines yet. Add them in the room, under the options box.",
  },
  {
    key: "special",
    title: "Special lines",
    lead: "Lines somebody wrote for this job. These are the ones worth reading twice — they were typed once, in a hurry, and nothing else checks them.",
    empty: "Nothing special on this room — every line came from a blueprint.",
  },
] as const;

type StepKey = typeof STEPS[number]["key"];

// standard = came with a blueprint · special = somebody wrote it here.
const groupOf = (i: Item): StepKey =>
  i.kind === "option" ? "optional" : i.origin === "blueprint copy" ? "standard" : "special";

export const dynamic = "force-dynamic";

export default async function ScopeStepPage({
  params, searchParams,
}: {
  params: Promise<{ id: string; pkg: string }>;
  searchParams: Promise<{ step?: string; ok?: string; error?: string; n?: string; held?: string }>;
}) {
  const { id, pkg: pkgId } = await params;
  const { step, ok, error, n, held } = await searchParams;

  const w = stopwatch("/project/[id]/bids/[pkg]/scope");
  const supabase = await createClient();
  const { data: claims } = await w.step("claims", () => supabase.auth.getClaims());
  if (!claims) redirect(`/login?next=/project/${id}/bids/${pkgId}/scope`);

  const { data } = await w.step("package", () => rpc<Pkg>(supabase, "portal_bid_package", { p_pkg: pkgId }));
  const p = (data ?? null) as Pkg | null;
  if (!p?.id) notFound();
  w.done();

  const room = `/project/${id}/bids/${pkgId}`;
  const canWrite = p.can_edit && !p.awarded_bid_id;

  const at = Math.max(0, STEPS.findIndex((s) => s.key === step));
  const here = STEPS[at];
  const last = at === STEPS.length - 1;
  const mine = p.items.filter((i) => groupOf(i) === here.key);
  const nextHref = last ? room : `${room}/scope?step=${STEPS[at + 1].key}`;

  // How each group stands, so the rail says what is left rather than only
  // where you are.
  const tally = STEPS.map((s) => {
    const rows = p.items.filter((i) => groupOf(i) === s.key);
    return { ...s, total: rows.length, inCount: rows.filter((i) => i.is_included).length };
  });

  return (
    <Screen>
      <AppBar back={room} title="Scope" sub={p.category ?? p.trade ?? p.project_name} />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}
        {ok === "refined" && (
          <div className="banner-ok">
            Saved{n ? ` — ${n}` : ""}.
            {held && ` Kept anyway, because somebody already priced them: ${held}.`}
          </div>
        )}

        {/* WHERE YOU ARE, AND WHAT IS LEFT. Three dots with counts beat a
            percentage: the question "how many lines am I still deciding on"
            is the one somebody halfway through actually has. */}
        <nav className="scope-rail" aria-label="The three kinds of line">
          {tally.map((s, ix) => (
            <Link key={s.key} href={`${room}/scope?step=${s.key}`} scroll={false}
              className={`scope-step ${ix === at ? "on" : ""}`} aria-current={ix === at ? "step" : undefined}>
              <span className="n">{ix + 1}</span>
              <span className="t">{s.title.replace(" lines", "")}</span>
              <span className="c">{s.total === 0 ? "none" : `${s.inCount} of ${s.total} in`}</span>
            </Link>
          ))}
        </nav>

        <Card pad>
          <h2 className="card-title" style={{ fontSize: 17, marginTop: 0 }}>
            {here.title} <span className="text-muted" style={{ fontWeight: 400 }}>· step {at + 1} of {STEPS.length}</span>
          </h2>
          <p className="small text-muted" style={{ marginTop: 4 }}>{here.lead}</p>

          {mine.length === 0 && (
            <Notice title="Nothing to decide here.">{here.empty}</Notice>
          )}

          {mine.length > 0 && (
            <form action={refineLines.bind(null, id, pkgId)} className="stack" style={{ gap: 6, marginTop: 12 }}>
              {/* ONLY THIS GROUP'S IDS. refineLines walks the ids it is given,
                  so the other two groups are untouched by this step - which is
                  what makes saving as you go safe. */}
              <input type="hidden" name="ids" value={mine.map((i) => i.id).join(",")} />
              <input type="hidden" name="next" value={nextHref} />

              <div className="ref-row ref-head">
                <span className="tiny text-muted" style={{ textAlign: "center" }}>in</span>
                <span className="tiny text-muted">the line, as the bidders read it</span>
                <span className="tiny text-muted">or…</span>
              </div>

              {mine.map((i) => (
                <div className="ref-row" key={i.id}>
                  <input type="checkbox" className="ref-in" name={`in__${i.id}`}
                    defaultChecked={i.is_included !== false} disabled={!canWrite}
                    aria-label={`In this proposal: ${i.item}`} title="In this proposal" />
                  <input className="input ref-text" name={`item__${i.id}`} defaultValue={i.item}
                    readOnly={!canWrite} aria-label={`The wording: ${i.item}`} />
                  <select className="input ref-state" name={`state__${i.id}`} disabled={!canWrite}
                    defaultValue={i.kind === "option" ? "option" : ""}
                    aria-label={`Anything special about this line: ${i.item}`}>
                    <option value="">—</option>
                    <option value="option">Priced separately</option>
                    <option value="drop">Remove the line</option>
                  </select>
                </div>
              ))}

              {canWrite && (
                <>
                  <label className="field" style={{ marginBottom: 0, marginTop: 8 }}>
                    <span className="field-label">Why the ones you untick are out (optional)</span>
                    <input className="input" name="why" placeholder="New build — nothing to tear off" />
                  </label>
                  <button className="btn btn-primary btn-block">
                    {last ? "Save and finish" : `Save and go to ${STEPS[at + 1].title.toLowerCase()}`}
                  </button>
                </>
              )}
            </form>
          )}

          {/* Nothing to save on an empty step, so it still has to go somewhere. */}
          {mine.length === 0 && (
            <Link href={nextHref} className="btn btn-primary btn-block" style={{ marginTop: 12 }}>
              {last ? "Back to the room" : `Go to ${STEPS[at + 1].title.toLowerCase()}`}
            </Link>
          )}

          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {at > 0 && (
              <Link href={`${room}/scope?step=${STEPS[at - 1].key}`} className="btn btn-ghost small" scroll={false}>
                ← {STEPS[at - 1].title}
              </Link>
            )}
            <Link href={room} className="btn btn-ghost small">Back to the room</Link>
          </div>
        </Card>

        {!canWrite && (
          <Notice title={p.awarded_bid_id ? "This package is awarded." : "The scope is not yours to change."}>
            {p.awarded_bid_id
              ? "The lines are what the winning price was given against, so they stand. Undo the award in the room if they are wrong."
              : "You can read what was asked for; whoever runs the job writes it."}
          </Notice>
        )}

        <p className="tiny text-muted" style={{ margin: 0 }}>
          An <strong>unticked</strong> line stays on the room with its reason, is hidden from every bidder, and stops
          counting against anybody who left it out. <strong>Remove the line</strong> takes it off the room for good —
          it stays on the job. A line somebody has already priced is kept whatever you pick.
        </p>
      </div>
    </Screen>
  );
}
