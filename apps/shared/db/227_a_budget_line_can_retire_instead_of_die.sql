-- A BUDGET LINE CAN RETIRE INSTEAD OF DIE.
--
-- Shahar, 2026-09-24, on the wizard's edit panel: "instead of delete the
-- line for now just enable to disable it, which will push it to the end
-- under a disabled section."
--
-- Delete only worked on a line nothing referenced; everything else was
-- stuck. Disable works on ANY line: one nullable timestamp, so the row -
-- and every payment, contract and package filed against it - stays exactly
-- where it is (rule 30). A disabled line keeps its PAID history in the
-- rollup but stops counting toward the plan: its target and agreed drop to
-- zero in portal_finance_rollup, because a retired line is no longer a
-- promise to spend. The wizard files disabled lines at the bottom under
-- their own section; enabling clears the timestamp and the line comes back.
--
-- portal_budget_line_delete stays for the truly untouched line.

alter table public.budget_categories
  add column if not exists disabled_at timestamptz;

comment on column public.budget_categories.disabled_at is
  'When the line was retired from the plan (227). NULL means live. A '
  'disabled line keeps everything filed against it and its paid history '
  'still counts in the rollup; only its target/agreed leave the plan.';

-- The wizard's read grows one additive key per line: disabled_at.
create or replace function public.portal_budget_lines(p_project uuid, p_q text default null)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when not public.bid_can_manage(p_project)
    then jsonb_build_object('ok', false, 'reason', 'This project''s budget is not yours to see.')
    else jsonb_build_object('ok', true,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', bc.id, 'category', bc.category, 'phase', bc.phase, 'trade', bc.trade,
          'cost_type', bc.cost_type, 'is_builder_scope', bc.is_builder_scope,
          'target_amount', bc.target_amount, 'agreed_amount', bc.agreed_amount, 'notes', bc.notes,
          'disabled_at', bc.disabled_at,
          'actual_paid', coalesce(tx.actual_paid, 0), 'open_committed', coalesce(tx.open_committed, 0),
          'package_id', pk.id, 'package_status', pk.status,
          'contract_id', ct.id, 'contract_title', ct.title, 'contract_status', ct.status,
          'contract_amount', ct.amount, 'contract_signed', ct.signed_date
        ) order by (bc.disabled_at is not null), bc.phase nulls last, bc.category)
        from public.budget_categories bc
        left join lateral (
          select sum(t.amount) filter (where t.status in ('paid','paid - receipt filed','paid - pending confirmation','settled')) as actual_paid,
                 sum(t.amount) filter (where t.status in ('scheduled','forecast','invoice received','approved','disputed')) as open_committed
            from public.transactions t
           where t.budget_category_id = bc.id and t.source_account_id is not null) tx on true
        left join lateral (
          select p.id, p.status from public.bid_packages p
           where p.budget_category_id = bc.id
           order by p.created_at desc limit 1) pk on true
        left join lateral (
          select c.id, c.title, c.status, c.amount, c.signed_date from public.contracts c
           where lower(c.status) <> 'cancelled'
             and (c.budget_category_id = bc.id
                  or exists (select 1 from public.contract_budget_allocations a
                              where a.budget_category_id = bc.id and a.contract_id = c.id))
           order by c.created_at desc limit 1) ct on true
        where bc.project_id = p_project
          and (p_q is null or btrim(p_q) = '' or bc.category ilike '%' || btrim(p_q) || '%'
               or bc.trade ilike '%' || btrim(p_q) || '%')
      ), '[]'::jsonb),
      'contracts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'title', c.title, 'trade', c.trade, 'status', c.status,
          'amount', c.amount, 'budget_category_id', c.budget_category_id
        ) order by c.created_at desc)
        from public.contracts c
        where c.project_id = p_project and lower(c.status) <> 'cancelled'
      ), '[]'::jsonb),
      'seed_sources', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.project_name, 'lines', s.n)
                         order by s.n desc)
        from (select p.id, p.project_name, count(*) as n
                from public.budget_categories bc
                join public.projects p on p.id = bc.project_id
               where p.id <> p_project and p.trashed_at is null
               group by p.id, p.project_name) s
        where public.bid_can_manage(s.id)
      ), '[]'::jsonb),
      'trades', (select jsonb_agg(t.trade order by t.trade) from public.trades t
                  where t.trade not in ('ALL', 'Meta')),
      'phases', (select jsonb_agg(ph.phase_key order by ph.sort_order) from public.phases ph),
      'cost_types', (select jsonb_agg(ctp.cost_type order by ctp.sort_order) from public.cost_types ctp))
  end;
$$;

comment on function public.portal_budget_lines(uuid, text) is
  'The budget wizard''s one read: a project''s budget lines with money and '
  'linkage (latest bid package, live contract), the form vocabularies, and '
  'seedable source projects. p_q filters by category or trade name. Guarded '
  'by bid_can_manage, like the bid room. disabled_at (227) marks retired '
  'lines, sorted last.';

-- Save learns one key: disabled (boolean). True stamps disabled_at (keeping
-- an earlier stamp), false clears it, absent leaves it alone - same
-- only-the-keys-present contract as every other field.
create or replace function public.portal_budget_line_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_project uuid;
  v_cat text := nullif(btrim(coalesce(p->>'category', '')), '');
begin
  if v_id is not null then
    select project_id into v_project from public.budget_categories where id = v_id;
    if v_project is null then return jsonb_build_object('ok', false, 'reason', 'That budget line does not exist.'); end if;
  else
    v_project := nullif(p->>'project_id', '')::uuid;
  end if;
  if v_project is null or not public.bid_can_manage(v_project) then
    return jsonb_build_object('ok', false, 'reason', 'This project''s budget is not yours to edit.');
  end if;

  if v_id is null then
    if v_cat is null then return jsonb_build_object('ok', false, 'reason', 'Give the line a name.'); end if;
    if exists (select 1 from public.budget_categories b
                where b.project_id = v_project and lower(btrim(b.category)) = lower(v_cat)) then
      return jsonb_build_object('ok', false, 'reason', 'This project already has that line - edit it instead.');
    end if;
    insert into public.budget_categories (project_id, category, phase, trade, cost_type,
                                          target_amount, notes, is_builder_scope, created_by)
    values (v_project, v_cat,
            nullif(p->>'phase', ''), nullif(p->>'trade', ''), nullif(p->>'cost_type', ''),
            nullif(p->>'target_amount', '')::numeric, nullif(btrim(coalesce(p->>'notes', '')), ''),
            coalesce((p->>'is_builder_scope')::boolean, false), 'portal:budget')
    returning id into v_id;
  else
    update public.budget_categories b set
      category      = case when p ? 'category' then coalesce(v_cat, b.category) else b.category end,
      phase         = case when p ? 'phase' then nullif(p->>'phase', '') else b.phase end,
      trade         = case when p ? 'trade' then nullif(p->>'trade', '') else b.trade end,
      cost_type     = case when p ? 'cost_type' then nullif(p->>'cost_type', '') else b.cost_type end,
      target_amount = case when p ? 'target_amount' then nullif(p->>'target_amount', '')::numeric else b.target_amount end,
      notes         = case when p ? 'notes' then nullif(btrim(coalesce(p->>'notes', '')), '') else b.notes end,
      is_builder_scope = case when p ? 'is_builder_scope' then coalesce((p->>'is_builder_scope')::boolean, false) else b.is_builder_scope end,
      disabled_at   = case when p ? 'disabled'
                           then case when coalesce((p->>'disabled')::boolean, false)
                                     then coalesce(b.disabled_at, now()) end
                           else b.disabled_at end
    where b.id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

comment on function public.portal_budget_line_save(jsonb) is
  'Create or edit one budget line from the wizard. Insert refuses a name the '
  'project already carries; update touches only the keys in the payload. '
  'Never writes agreed_amount - that is derived from contracts (222). '
  'disabled=true/false (227) retires or revives the line.';

-- The rollup: a retired line's target and agreed leave the plan; the money
-- already paid (or scheduled) against it stays real. Only the cat_rows CTE
-- changes; the shape is untouched.
create or replace function public.portal_finance_rollup(p_project_id uuid default null::uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
with my_ids as (
  select distinct pm.project_id from project_members pm
  where pm.app_user_id = public.current_app_user_id() and pm.status = 'active'
),
proj as (
  select p.id, p.project_name from projects p
  join my_ids m on m.project_id = p.id
  where p.trashed_at is null and (p_project_id is null or p.id = p_project_id)
),
tx_by_cat as (
  select budget_category_id,
    sum(amount) filter (where status in ('paid','paid - receipt filed','paid - pending confirmation','settled')) as actual_paid,
    sum(amount) filter (where status in ('scheduled','forecast','invoice received','approved','disputed')) as open_committed
  from transactions
  where source_account_id is not null and budget_category_id is not null
  group by budget_category_id
),
cat_rows as (
  select bc.project_id,
    coalesce(nullif(btrim(bc.phase), ''), 'Other') as phase,
    coalesce(nullif(btrim(bc.category), ''), '(uncategorized)') as trade,
    bc.trade as real_trade,
    bc.cost_type, coalesce(bc.is_builder_scope, false) as is_builder_scope,
    -- Retired lines (227) plan nothing; what they already cost stays.
    case when bc.disabled_at is null then coalesce(bc.target_amount, 0) else 0 end as budget,
    case when bc.disabled_at is null then coalesce(bc.agreed_amount, 0) else 0 end as agreed,
    coalesce(t.actual_paid, 0) as actual_paid,
    coalesce(t.open_committed, 0) as open_committed
  from budget_categories bc
  join proj pr on pr.id = bc.project_id
  left join tx_by_cat t on t.budget_category_id = bc.id
),
uncat as (
  select tr.project_id,
    'Unassigned'::text as phase,
    'Not linked to a budget line'::text as trade,
    null::text as real_trade,
    null::text as cost_type, false as is_builder_scope,
    0::numeric as budget, 0::numeric as agreed,
    coalesce(sum(tr.amount) filter (where tr.status in ('paid','paid - receipt filed','paid - pending confirmation','settled')), 0) as actual_paid,
    coalesce(sum(tr.amount) filter (where tr.status in ('scheduled','forecast','invoice received','approved','disputed')), 0) as open_committed
  from transactions tr
  join proj pr on pr.id = tr.project_id
  where tr.source_account_id is not null and tr.budget_category_id is null
  group by tr.project_id
  having coalesce(sum(tr.amount), 0) <> 0
),
allrows as (
  select project_id, phase, trade, real_trade, cost_type, is_builder_scope, budget, agreed, actual_paid, open_committed from cat_rows
  union all
  select project_id, phase, trade, real_trade, cost_type, is_builder_scope, budget, agreed, actual_paid, open_committed from uncat
),
grp as (
  select project_id, phase, trade,
    max(cost_type) as cost_type,
    bool_or(is_builder_scope) as is_builder_scope,
    sum(budget) as budget, sum(agreed) as agreed,
    sum(actual_paid) as actual_paid, sum(open_committed) as open_committed
  from allrows group by project_id, phase, trade
),
trade_grp as (
  select project_id,
    coalesce(real_trade, trade) as label,
    (real_trade is not null) as is_trade,
    sum(budget) as budget, sum(agreed) as agreed,
    sum(actual_paid) as actual_paid, sum(open_committed) as open_committed
  from allrows group by project_id, coalesce(real_trade, trade), (real_trade is not null)
),
trade_json as (
  select project_id,
    jsonb_agg(jsonb_build_object(
      'label', label, 'is_trade', is_trade,
      'budget', budget, 'agreed', agreed,
      'actual_paid', actual_paid, 'open_committed', open_committed
    ) order by budget desc, label) as by_trade
  from trade_grp group by project_id
),
phase_rows as (
  select project_id, phase,
    sum(budget) as budget, sum(agreed) as agreed,
    sum(actual_paid) as actual_paid, sum(open_committed) as open_committed,
    jsonb_agg(jsonb_build_object(
      'trade', trade, 'cost_type', cost_type, 'is_builder_scope', is_builder_scope,
      'budget', budget, 'agreed', agreed, 'actual_paid', actual_paid, 'open_committed', open_committed
    ) order by budget desc, trade) as trades
  from grp group by project_id, phase
),
proj_rows as (
  select pr.id as project_id, pr.project_name,
    coalesce(sum(ph.budget), 0) as budget,
    coalesce(sum(ph.agreed), 0) as agreed,
    coalesce(sum(ph.actual_paid), 0) as actual_paid,
    coalesce(sum(ph.open_committed), 0) as open_committed,
    coalesce(jsonb_agg(jsonb_build_object(
      'phase', ph.phase, 'budget', ph.budget, 'agreed', ph.agreed,
      'actual_paid', ph.actual_paid, 'open_committed', ph.open_committed, 'trades', ph.trades
    ) order by (ph.phase = 'Unassigned'), (ph.phase = 'Other'), ph.phase)
      filter (where ph.phase is not null), '[]'::jsonb) as phases,
    coalesce(tj.by_trade, '[]'::jsonb) as by_trade
  from proj pr
  left join phase_rows ph on ph.project_id = pr.id
  left join trade_json tj on tj.project_id = pr.id
  group by pr.id, pr.project_name, tj.by_trade
)
select jsonb_build_object(
  'projects', coalesce(jsonb_agg(jsonb_build_object(
    'project_id', project_id, 'project_name', project_name,
    'budget', budget, 'agreed', agreed, 'actual_paid', actual_paid, 'open_committed', open_committed,
    'phases', phases, 'by_trade', by_trade
  ) order by budget desc), '[]'::jsonb),
  'totals', jsonb_build_object(
    'budget', coalesce(sum(budget), 0), 'agreed', coalesce(sum(agreed), 0),
    'actual_paid', coalesce(sum(actual_paid), 0), 'open_committed', coalesce(sum(open_committed), 0))
) from proj_rows;
$function$;
