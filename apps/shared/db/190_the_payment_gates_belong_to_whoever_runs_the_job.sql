-- 190: THE PAYMENT GATES BELONG TO WHOEVER RUNS THE JOB.
--
-- Shahar (2026-09-18), describing the flow he actually has: "I've been on
-- site, met the framer. Got into the Framing section to see how much money is
-- left, what are the next payment gates, etc., and I can either log a task
-- related to his project, or payment."
--
-- payment_stages already hold exactly that - the gate, what it is worth, what
-- has to be true before it can be claimed, and whether it needs a photograph.
-- Two things stopped the trade screen from showing them.
--
-- ONE: WHO MAY SEE THEM. The read said
--
--     c.contractor_id = me.contact_id
--     or (can_edit_project(p) and is_superadmin())
--
-- so a project manager who runs the job but is not a platform superadmin saw
-- NOTHING - unless they happened to be the contractor on the contract, which
-- a PM never is. The people this screen is for were the exact people it
-- refused. can_view_project_financials is the money ladder every other money
-- read on this screen already uses (portal_site_week hands back the contracts
-- under it), so this shows no more than the screen was showing already.
--
-- TWO: WHICH TRADE. A gate carried its contract's title and not its trade, so
-- a screen about Framing could not tell a framing gate from a plumbing one.
--
-- Applied as 190a.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_my_milestones(uuid)'::regprocedure);

  out_ := replace(src,
    $old$      'contract_title', c.title)$old$,
    $new$      'contract_title', c.title, 'contract_id', c.id, 'trade', c.trade)$new$);
  if out_ = src then raise exception 'portal_my_milestones has drifted - the contract_title line was not found.'; end if;

  out_ := replace(out_,
    $old$      and (c.contractor_id = me.contact_id
           or (public.can_edit_project(p_project) and public.is_superadmin()))$old$,
    $new$      and (c.contractor_id = me.contact_id
           or public.can_view_project_financials(p_project))$new$);
  execute out_;
end $patch$;

comment on function public.portal_my_milestones(uuid) is
  'The payment gates on a job: what each one is worth, what has to be true to claim it, whether it needs a photograph - carrying the contract and its trade so one trade''s screen can show its own. Visible to the contractor it belongs to, and to whoever the money ladder already lets see this project''s money.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
