-- A BUDGET LINE KNOWS ITS TRADE, AND AN AWARD INTRODUCES IT TO ITS CONTRACT.
--
-- Shahar, 2026-09-23: "what is my project budget per trade or large scope,
-- and where am I against it... set budget per project, initiate project bids
-- and award them, link every line to a signed contract once awarded."
--
-- Almost all of that machinery existed - budget_categories, the bid room,
-- portal_bid_award making a contract, portal_finance_rollup reading it back.
-- Three things did not:
--
--   1. TRADE. budget_categories had no trade column, so "budget per trade"
--      was answered by squinting at category text. Now a foreign key to
--      trades (section 32: a trade is never free text), backfilled from the
--      contracts and bid packages already pointing at each line.
--
--   2. THE HANDSHAKE. Awarding a bid made a contract and set its amount, but
--      never told the budget line. Now the award writes the package's
--      budget_category_id onto the contract, and a trigger keeps
--      agreed_amount equal to what the line's live contracts say - section
--      34: derived, never remembered. Hand-set agreed values on lines that no
--      contract references are left exactly as they are (which is why this
--      migration does NO mass recompute - 55 Walnut's hand-tuned agreed
--      figures stay put until a linked contract actually changes).
--
--   3. THE WIZARD'S VERBS. No portal function could create, edit, seed or
--      delete a budget line, or link one to a contract after the fact. Five
--      small ones now can, guarded by bid_can_manage like the bid room.
--
-- portal_finance_rollup grows one ADDITIVE key per project - by_trade -
-- grouping lines by trade where set, else by category (the "large scope").
-- Existing consumers keep their shape.

-- 1 ------------------------------------------------------------------ trade
alter table public.budget_categories
  add column if not exists trade text references public.trades(trade)
    on update cascade on delete restrict;

comment on column public.budget_categories.trade is
  'Which trade this line belongs to, from the trades vocabulary. Nullable: '
  'lines like permits, taxes or financing honestly have none, and then the '
  'category text is the grouping ("large scope"). Backfilled in 222 from the '
  'contracts / bid packages that referenced each line.';

update public.budget_categories bc
   set trade = c.trade
  from public.contracts c
 where c.budget_category_id = bc.id and bc.trade is null and c.trade is not null;

update public.budget_categories bc
   set trade = p.trade
  from public.bid_packages p
 where p.budget_category_id = bc.id and bc.trade is null and p.trade is not null;

-- 2 --------------------------------------------- agreed_amount is derived
-- Recompute one line's agreed_amount from its live contracts: allocation
-- rows first (a contract split over several lines), else the contract's own
-- amount. Cancelled contracts do not count; a unit-price contract with a
-- null amount contributes nothing (help: money). No links at all means NULL
-- - and this function is ONLY called for lines a changing contract or
-- allocation touches, so a hand-set agreed on a never-linked line is never
-- passed through here and never clobbered.
create or replace function public.fn_budget_agreed_refresh(p_line uuid)
returns void language sql security definer set search_path to 'public' as $$
  update public.budget_categories bc
     set agreed_amount = (
       select case when count(*) > 0 then sum(x.amount) end
         from (
           select cba.amount
             from public.contract_budget_allocations cba
             join public.contracts c on c.id = cba.contract_id
            where cba.budget_category_id = p_line and lower(c.status) <> 'cancelled'
           union all
           select c.amount
             from public.contracts c
            where c.budget_category_id = p_line
              and lower(c.status) <> 'cancelled' and c.amount is not null
              and not exists (select 1 from public.contract_budget_allocations a
                               where a.contract_id = c.id)
         ) x)
   where bc.id = p_line;
$$;

comment on function public.fn_budget_agreed_refresh(uuid) is
  'Keeps budget_categories.agreed_amount equal to what the line''s live '
  'contracts say (allocations first, else contract amount; cancelled ones '
  'excluded). Called by the triggers on contracts and '
  'contract_budget_allocations - never in bulk, so hand-set agreed values on '
  'unlinked lines survive.';

create or replace function public.trg_budget_agreed_from_contracts()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.budget_category_id is not null then
    perform public.fn_budget_agreed_refresh(old.budget_category_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.budget_category_id is not null then
    perform public.fn_budget_agreed_refresh(new.budget_category_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_contracts_budget_agreed on public.contracts;
create trigger trg_contracts_budget_agreed
  after insert or delete or update of budget_category_id, amount, status
  on public.contracts
  for each row execute function public.trg_budget_agreed_from_contracts();

create or replace function public.trg_budget_agreed_from_allocations()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.fn_budget_agreed_refresh(old.budget_category_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.fn_budget_agreed_refresh(new.budget_category_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_cba_budget_agreed on public.contract_budget_allocations;
create trigger trg_cba_budget_agreed
  after insert or delete or update of budget_category_id, amount
  on public.contract_budget_allocations
  for each row execute function public.trg_budget_agreed_from_allocations();

-- 3 --------------------------------- the award tells the budget line about it
-- Same body as live (fetched 2026-09-23), plus one addition at the end of
-- the contract-dressing block: the package's budget line lands on the
-- contract, which fires the trigger above and sets agreed_amount.
create or replace function public.portal_bid_award(p_pkg uuid, p_bid uuid, p_reason text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare pk public.bid_packages; b public.bids; v_seat jsonb; v_contract uuid;
begin
  select * into pk from public.bid_packages where id = p_pkg for update;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Awarding this package is not yours to do.');
  end if;
  if pk.awarded_bid_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'This package is already awarded.');
  end if;
  select * into b from public.bids where id = p_bid and package_id = pk.id;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'That reply is not on this package.'); end if;
  if b.status in ('invited', 'no response', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'That bidder has not replied - award a received bid.');
  end if;

  update public.bids set won = true, status = 'awarded', last_modified_at = now(), last_modified_by = 'portal:award'
   where id = b.id;
  update public.bids set won = false, status = 'not awarded',
         not_awarded_reason = coalesce(not_awarded_reason, 'Another bid was awarded on ' || current_date),
         last_modified_at = now(), last_modified_by = 'portal:award'
   where package_id = pk.id and id <> b.id and status not in ('invited', 'no response', 'expired', 'not awarded');
  update public.bid_packages set awarded_bid_id = b.id, status = 'awarded', last_modified_at = now(), last_modified_by = 'portal:award'
   where id = pk.id;
  if nullif(btrim(coalesce(p_reason, '')), '') is not null then
    update public.bids set notes = coalesce(notes || E'\n\n', '') || 'AWARD NOTE: ' || btrim(p_reason) where id = b.id;
  end if;
  if b.bidder_contact_id is not null then
    v_seat := public.portal_award_trade(pk.project_id, b.bidder_contact_id, pk.trade,
      'Won the bid' || coalesce(' for ' || pk.trade, '') || '.', null, true);
    if coalesce((v_seat->>'ok')::boolean, false) then
      v_contract := (v_seat->>'contract_id')::uuid;
      update public.bids set contract_id = v_contract where id = b.id;
      update public.bid_packages set contract_id = v_contract where id = pk.id;
      if b.amount is not null then
        update public.contracts set amount = coalesce(amount, b.amount) where id = v_contract;
      end if;
      -- HOW IT WAS LET (191). Winning a room is the route, and the room this
      -- bid belongs to is the evidence - no screen has to ask.
      update public.contracts c
         set award_route = 'bid', award_route_source = 'stated',
             bid_package_id = coalesce(c.bid_package_id, pk.id),
             -- REVIVED, NOT LEFT FOR DEAD (214). Undoing an award cancels the
             -- contract it made; awarding again reuses that same row.
             status = case when c.status = 'Cancelled' and exists (
                             select 1 from public.change_events ce
                              where ce.table_name = 'contracts' and ce.row_id = c.id::text
                                and ce.field = 'status' and ce.to_value = 'Cancelled'
                                and ce.actor = 'portal:unaward')
                           then coalesce((select ce2.from_value from public.change_events ce2
                                           where ce2.table_name = 'contracts' and ce2.row_id = c.id::text
                                             and ce2.field = 'status' and ce2.to_value = 'Cancelled'
                                           order by ce2.at desc limit 1), 'awarded')
                           else c.status end,
             notes = case when c.status = 'Cancelled' and exists (
                            select 1 from public.change_events ce3
                             where ce3.table_name = 'contracts' and ce3.row_id = c.id::text
                               and ce3.field = 'status' and ce3.to_value = 'Cancelled'
                               and ce3.actor = 'portal:unaward')
                          then coalesce(c.notes || E'\n\n', '') || 'Revived ' || to_char(current_date, 'YYYY-MM-DD')
                               || ' - the award was made again.'
                          else c.notes end
       where c.id = v_contract;
      -- THE HANDSHAKE (222). The package came from a budget line; the
      -- contract the award made now points back at it, and the trigger sets
      -- the line's agreed_amount from the contract. coalesce so a contract
      -- somebody already filed against another line is not re-filed.
      if pk.budget_category_id is not null then
        update public.contracts
           set budget_category_id = coalesce(budget_category_id, pk.budget_category_id)
         where id = v_contract;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'package_id', pk.id, 'bid_id', b.id,
    'contract_id', v_contract, 'seated', coalesce((v_seat->>'ok')::boolean, false),
    'seat_note', v_seat->>'reason',
    'bidder', (select coalesce(c.person_name, c.name) from public.contacts c where c.id = b.bidder_contact_id),
    'amount', b.amount,
    'contract_status', (select c.status from public.contracts c where c.id = v_contract));
end $function$;

-- 4 ----------------------------------------------------- the wizard's verbs

-- Everything the budget wizard shows, in one call: the lines with their
-- money and their linkage (latest package, live contract), plus the
-- vocabularies the forms need and the projects a budget can be seeded from.
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
          'contract_amount', ct.amount, 'contract_signed', ct.signed_date
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
  'by bid_can_manage, like the bid room.';

-- Create or edit one line. Insert refuses a category the project already
-- has (section 30: search before you create); update touches only the keys
-- present in the payload.
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
      is_builder_scope = case when p ? 'is_builder_scope' then coalesce((p->>'is_builder_scope')::boolean, false) else b.is_builder_scope end
    where b.id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

comment on function public.portal_budget_line_save(jsonb) is
  'Create or edit one budget line from the wizard. Insert refuses a name the '
  'project already carries; update touches only the keys in the payload. '
  'Never writes agreed_amount - that is derived from contracts (222).';

-- Delete a line nothing references. Anything already filed against it -
-- payments, contracts, allocations, bid packages - keeps it alive.
create or replace function public.portal_budget_line_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_project uuid; v_tx int; v_ct int; v_pk int;
begin
  select project_id into v_project from public.budget_categories where id = p_id;
  if v_project is null then return jsonb_build_object('ok', false, 'reason', 'That budget line does not exist.'); end if;
  if not public.bid_can_manage(v_project) then
    return jsonb_build_object('ok', false, 'reason', 'This project''s budget is not yours to edit.');
  end if;
  select count(*) into v_tx from public.transactions where budget_category_id = p_id;
  select count(*) into v_ct from public.contracts where budget_category_id = p_id;
  v_ct := v_ct + (select count(*) from public.contract_budget_allocations where budget_category_id = p_id);
  select count(*) into v_pk from public.bid_packages where budget_category_id = p_id;
  if v_tx + v_ct + v_pk > 0 then
    return jsonb_build_object('ok', false, 'reason',
      'This line is in use (' || v_tx || ' payments, ' || v_ct || ' contracts, ' || v_pk ||
      ' bid packages) - unlink those first.');
  end if;
  delete from public.budget_categories where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

comment on function public.portal_budget_line_delete(uuid) is
  'Deletes a budget line only when no payment, contract, allocation or bid '
  'package references it.';

-- Seed one project's budget from another's line list - the categories, not
-- the money. 55 Walnut's 100 lines are the new-build starting point Shahar
-- named on 2026-09-23; any project the caller manages can be a source.
create or replace function public.portal_budget_seed(p_project uuid, p_from uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_copied int;
begin
  if not public.bid_can_manage(p_project) or not public.bid_can_manage(p_from) then
    return jsonb_build_object('ok', false, 'reason', 'Both budgets need to be yours to touch.');
  end if;
  insert into public.budget_categories (project_id, category, phase, trade, cost_type, is_builder_scope, created_by)
  select p_project, s.category, s.phase, s.trade, s.cost_type,
         coalesce(s.is_builder_scope, false), 'portal:budget-seed'
    from (select distinct on (lower(btrim(category))) category, phase, trade, cost_type, is_builder_scope
            from public.budget_categories where project_id = p_from
           order by lower(btrim(category)), created_at) s
   where not exists (select 1 from public.budget_categories b
                      where b.project_id = p_project
                        and lower(btrim(b.category)) = lower(btrim(s.category)));
  get diagnostics v_copied = row_count;
  return jsonb_build_object('ok', true, 'copied', v_copied);
end $$;

comment on function public.portal_budget_seed(uuid, uuid) is
  'Copies another project''s budget LINE LIST (category, phase, trade, cost '
  'type - never the amounts) into this one, skipping names already present. '
  'The starting point for a new build is 55 Walnut''s list (Shahar '
  '2026-09-23).';

-- Link a line to a contract that did not come through the bid room - a
-- handshake made verbally, or paper signed before the system existed. The
-- trigger sets agreed_amount either way.
create or replace function public.portal_budget_link_contract(p_line uuid, p_contract uuid, p_unlink boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_project uuid; v_cproj uuid;
begin
  select project_id into v_project from public.budget_categories where id = p_line;
  if v_project is null then return jsonb_build_object('ok', false, 'reason', 'That budget line does not exist.'); end if;
  if not public.bid_can_manage(v_project) then
    return jsonb_build_object('ok', false, 'reason', 'This project''s budget is not yours to edit.');
  end if;
  select project_id into v_cproj from public.contracts where id = p_contract;
  if v_cproj is null or v_cproj <> v_project then
    return jsonb_build_object('ok', false, 'reason', 'That contract is not on this project.');
  end if;
  if p_unlink then
    update public.contracts set budget_category_id = null
     where id = p_contract and budget_category_id = p_line;
  else
    update public.contracts set budget_category_id = p_line where id = p_contract;
  end if;
  return jsonb_build_object('ok', true,
    'agreed_amount', (select agreed_amount from public.budget_categories where id = p_line));
end $$;

comment on function public.portal_budget_link_contract(uuid, uuid, boolean) is
  'Files a contract against a budget line (or takes it off one) when the '
  'link did not come from a bid award. The 222 trigger recomputes the '
  'line''s agreed_amount both ways.';

-- 5 ----------------------------------- the rollup answers "per trade" too
-- Same shape as before plus one additive key per project: by_trade, grouping
-- lines by trade where set, else by category text - the "large scope".
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
    coalesce(bc.target_amount, 0) as budget,
    coalesce(bc.agreed_amount, 0) as agreed,
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
-- BY TRADE (222): the trade where the line names one, else its category
-- text. is_trade says which of the two the label is.
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
