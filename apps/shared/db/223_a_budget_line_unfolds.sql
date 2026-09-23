-- A BUDGET LINE UNFOLDS - ITS PAYMENTS, ITS SCHEDULE, AND THE SPEND NOBODY FILED.
--
-- Shahar, 2026-09-23, reviewing the wizard's table: clicking a line should
-- unfold "additional info (schedule of payment made, etc)", and the table
-- needs a "place holder catcher for all other spend not attached to a
-- linked contract".
--
-- So portal_budget_lines (222) grows, same signature, same guard:
--   - each line carries 'payments' - its transactions, newest first - and
--     'stages' - the linked contract's payment schedule;
--   - the reply carries 'unattached' - the project's transactions that name
--     NO budget line, summed and listed, so money can never hide by being
--     unfiled. Same status buckets as portal_finance_rollup.
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
          'actual_paid', coalesce(tx.actual_paid, 0), 'open_committed', coalesce(tx.open_committed, 0),
          'package_id', pk.id, 'package_status', pk.status,
          'contract_id', ct.id, 'contract_title', ct.title, 'contract_status', ct.status,
          'contract_amount', ct.amount, 'contract_signed', ct.signed_date,
          'payments', coalesce(pay.list, '[]'::jsonb),
          'stages', coalesce(st.list, '[]'::jsonb)
        ) order by bc.phase nulls last, bc.category)
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
        left join lateral (
          select jsonb_agg(jsonb_build_object(
                   'id', t.id, 'paid_on', t.paid_on, 'amount', t.amount, 'status', t.status,
                   'description', t.description, 'reference', t.payment_reference
                 ) order by t.paid_on desc nulls last, t.created_at desc) as list
            from (select * from public.transactions t2
                   where t2.budget_category_id = bc.id and t2.source_account_id is not null
                   order by t2.paid_on desc nulls last, t2.created_at desc limit 20) t) pay on true
        left join lateral (
          select jsonb_agg(jsonb_build_object(
                   'name', s.name, 'amount', s.amount, 'due_on', s.due_on,
                   'settlement_status', s.settlement_status, 'paid_at', s.paid_at
                 ) order by s.sequence_no) as list
            from public.payment_stages s where s.contract_id = ct.id) st on true
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
      -- THE CATCHER. Spend that names this project but no budget line -
      -- summed and listed, so it can be seen, chased, and filed.
      'unattached', (
        select jsonb_build_object(
          'actual_paid', coalesce(sum(t.amount) filter (where t.status in ('paid','paid - receipt filed','paid - pending confirmation','settled')), 0),
          'open_committed', coalesce(sum(t.amount) filter (where t.status in ('scheduled','forecast','invoice received','approved','disputed')), 0),
          'count', count(*),
          'payments', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', u.id, 'paid_on', u.paid_on, 'amount', u.amount, 'status', u.status,
              'description', u.description, 'reference', u.payment_reference
            ) order by u.paid_on desc nulls last, u.created_at desc)
            from (select * from public.transactions t2
                   where t2.project_id = p_project and t2.budget_category_id is null
                     and t2.source_account_id is not null
                   order by t2.paid_on desc nulls last, t2.created_at desc limit 25) u), '[]'::jsonb))
        from public.transactions t
        where t.project_id = p_project and t.budget_category_id is null
          and t.source_account_id is not null),
      'trades', (select jsonb_agg(t.trade order by t.trade) from public.trades t
                  where t.trade not in ('ALL', 'Meta')),
      'phases', (select jsonb_agg(ph.phase_key order by ph.sort_order) from public.phases ph),
      'cost_types', (select jsonb_agg(ctp.cost_type order by ctp.sort_order) from public.cost_types ctp),
      'seed_sources', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.project_name, 'lines', s.n)
                         order by s.n desc)
        from (select p.id, p.project_name, count(*) as n
                from public.budget_categories bc
                join public.projects p on p.id = bc.project_id
               where p.id <> p_project and p.trashed_at is null
               group by p.id, p.project_name) s
        where public.bid_can_manage(s.id)
      ), '[]'::jsonb))
  end;
$$;

comment on function public.portal_budget_lines(uuid, text) is
  'The budget wizard''s one read (222, unfolded in 223): a project''s budget '
  'lines with money, linkage, their payments and the linked contract''s '
  'payment schedule; the project''s UNATTACHED spend (no budget line) summed '
  'and listed; the form vocabularies and seedable source projects. p_q '
  'filters by category or trade name. Guarded by bid_can_manage.';
