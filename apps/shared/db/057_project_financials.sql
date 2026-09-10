-- 057 - project financials: a contract's whole life from a payment
-- standpoint, on one page, for the payor, the payee, the investor and the
-- project owner (Shahar, 2026-09-10).
--
-- NOTHING STRUCTURAL IS ADDED. Everything the page needs already had a
-- home: contracts (a change order IS a contract with parent_contract_id -
-- Shahar, 2026-08-31, contract_types 'change order'), payment_stages,
-- transactions, stage_settlements, files + file_links (contract_id,
-- payment_stage_id), project_scope_items (authority 'change order'), the
-- confirmation task fn_transactions_notify_task already writes, and the
-- visibility helpers of rulebook 70. What was missing was the surface: one
-- read that assembles it, and writes that go through the EXISTING single
-- paths - record_manual_payment for money (rulebook 52: one write path),
-- close_action for the receipt confirmation, record_project_file for
-- evidence - rather than an app touching tables.
--
-- WHO SEES WHAT (rulebook 70, help topic people):
--   the owner side  - can_view_project_financials (owner / manager seats)
--                     sees every contract on the project and its jobs;
--   an investor     - a seat whose project_roles.sees_financials is true
--                     (Investor, Partner, asset owner, site GC) reads the
--                     same, and can write nothing;
--   the payee       - the contract's counterparty (i_am_contract_party) or
--                     a contract-bounded seat at rank >= 30 on it: their own
--                     contract, its change orders, milestones and payments,
--                     nothing else's.
-- fin_may_record (the payor side) is can_view_project_financials, as
-- record_manual_payment already demands.
--
-- THE ADDITIONS a contractor asks for mid-job - "I need $750 more for the
-- second sump pit" - are CHANGE ORDERS: a child contract under the one it
-- changes (amount, scope, why), a scope line under the parent so it is
-- captured against the scope of work delivered, the photograph / receipt /
-- voice note attached to it, and a decision task for the owner. Approving
-- one gives it a single payment stage, so it is paid through the same
-- machinery as every milestone and lands in the same ledger.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The project and everything beneath it (a property's jobs), untrashed.
create or replace function public.fin_family(p_project uuid)
returns table(project_id uuid)
language sql stable security definer set search_path to 'public'
as $$
  with recursive fam as (
    select p.id from public.projects p where p.id = p_project
    union all
    select c.id from public.projects c join fam on c.parent_project_id = fam.id
     where c.trashed_at is null
  )
  select id from fam
$$;

-- The payee of a contract: its counterparty, the contractor it names, or a
-- bounded seat on it. A change order's payee is its parent's.
create or replace function public.fin_is_payee(p_contract uuid)
returns boolean
language plpgsql stable security definer set search_path to 'public'
as $$
declare c public.contracts; root uuid; me_contact uuid;
begin
  if public.is_superadmin() then return true; end if;
  select * into c from public.contracts where id = p_contract;
  if c.id is null then return false; end if;
  root := coalesce(c.parent_contract_id, c.id);
  me_contact := public.contact_id_for_app_user(public.current_app_user_id());
  return public.i_am_contract_party(c.id) or public.i_am_contract_party(root)
      or (me_contact is not null and me_contact in (c.contractor_id, (select x.contractor_id from public.contracts x where x.id = root)))
      or (public.my_authority_rank(c.project_id) >= 30
          and root in (select contract_id from public.my_contract_ids(c.project_id)));
end $$;

-- The payor side: who may set up milestones, approve, record money, decide
-- a change order. The same test record_manual_payment makes.
create or replace function public.fin_may_record(p_project uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$ select public.can_view_project_financials(p_project) $$;

-- Who reads the whole project's money: the payor side, plus any seat whose
-- role says it sees financials - the investor, the partner.
create or replace function public.fin_sees_all(p_project uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select public.can_view_project_financials(p_project) or exists (
    select 1 from public.project_members pm
      join public.project_roles r on r.role = pm.project_role
     where pm.app_user_id = public.current_app_user_id()
       and pm.status = 'active' and r.sees_financials
       and pm.project_id in (select project_id from public.project_ancestry(p_project)))
$$;

-- The files hanging off a contract or a stage.
create or replace function public.fin_evidence(p_contract uuid default null, p_stage uuid default null)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'file_id', f.id, 'file_name', f.file_name, 'kind', f.kind, 'mime', f.mime_type,
           'bucket', f.bucket, 'path', f.path, 'role', fl.role, 'at', fl.created_at,
           'who', (select coalesce(u.full_name, u.email) from public.app_users u where u.id = fl.created_by_user_id))
           order by fl.created_at desc), '[]'::jsonb)
    from public.file_links fl join public.files f on f.id = fl.file_id
   where (p_stage is not null and fl.payment_stage_id = p_stage)
      or (p_contract is not null and fl.contract_id = p_contract)
$$;

-- ---------------------------------------------------------------------------
-- THE READ. Everything the page draws, in one call, already filtered to
-- what this person may see. Amounts are dollars, as the tables hold them.
-- ---------------------------------------------------------------------------
create or replace function public.project_financials(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id();
  pr public.projects;
  v_all boolean; v_rec boolean; v_rank int;
  v_contact uuid; v_name text;
  v_contracts jsonb; v_unassigned jsonb := '[]'::jsonb; v_other jsonb := null; v_methods jsonb;
  v_agreed numeric; v_paid numeric; v_retained numeric; v_requested numeric; v_other_paid numeric := 0;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into pr from public.projects where id = p_project;
  if pr.id is null then return jsonb_build_object('ok', false, 'reason', 'No such project.'); end if;
  if not (public.is_project_member(p_project) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'reason', 'You are not on this project.');
  end if;

  v_all  := public.fin_sees_all(p_project);
  v_rec  := public.fin_may_record(p_project);
  v_rank := public.my_authority_rank(p_project);
  select u.contact_id, coalesce(u.full_name, u.email) into v_contact, v_name from public.app_users u where u.id = me;

  if not v_all and not exists (
      select 1 from public.contracts c
       where c.project_id in (select project_id from public.fin_family(p_project))
         and c.parent_contract_id is null and public.fin_is_payee(c.id)) then
    return jsonb_build_object('ok', false, 'reason', 'Money on this project is not yours to see.');
  end if;

  select coalesce(jsonb_agg(x.j order by x.rank_order, x.amount desc nulls last, x.title), '[]'::jsonb)
    into v_contracts
  from (
    select c.title, c.amount,
      case when c.status = 'placeholder' then 2 when c.status in ('Complete','Cancelled') then 1 else 0 end as rank_order,
      jsonb_build_object(
        'id', c.id, 'title', c.title, 'trade', c.trade, 'type', c.contract_type, 'status', c.status,
        'amount', c.amount, 'currency', c.currency, 'retainage_pct', c.retainage_pct, 'deposit_pct', c.deposit_pct,
        'net_days', c.net_days, 'scope', c.scope, 'signed_date', c.signed_date,
        'method', (select m.name from public.payment_methods m where m.id = c.default_payment_method_id),
        'project', jsonb_build_object('id', p.id, 'name', p.project_name),
        'contractor', coalesce(
          (select jsonb_build_object('id', k.id, 'name', coalesce(k.person_name, k.name),
                   'company', (select co.company_name from public.companies co where co.id = coalesce(c.counterparty_company_id, k.company_id)))
             from public.contacts k where k.id = c.contractor_id),
          (select jsonb_build_object('id', null, 'name', co.company_name, 'company', co.company_name)
             from public.companies co where co.id = c.counterparty_company_id),
          (select jsonb_build_object('id', k.id, 'name', coalesce(k.person_name, k.name), 'company', null)
             from public.contacts k where k.id = c.counterparty_contact_id)),
        'payee', public.fin_is_payee(c.id),
        'evidence', public.fin_evidence(c.id, null),
        'change_orders', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', co.id, 'title', co.title, 'amount', co.amount, 'status', co.status, 'scope', co.scope,
            'notes', co.notes, 'created_at', co.created_at, 'created_by', co.created_by,
            'approved', co.status in ('approved','signed','active','Active','awarded','Complete','verbal'),
            'evidence', public.fin_evidence(co.id, null),
            'stage', (select jsonb_build_object('id', s.id, 'status', s.status, 'settlement_status', s.settlement_status, 'paid_at', s.paid_at)
                        from public.payment_stages s where s.contract_id = co.id order by s.sequence_no limit 1)
          ) order by co.created_at), '[]'::jsonb)
          from public.contracts co where co.parent_contract_id = c.id),
        'stages', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', s.id, 'name', s.name, 'sequence_no', s.sequence_no,
            'amount', coalesce(s.amount, case when s.percent_of_contract is not null and c.amount is not null
                                              then round(c.amount * s.percent_of_contract / 100, 2) end),
            'percent', s.percent_of_contract, 'trigger', s.trigger_description, 'due_on', s.due_on,
            'status', s.status, 'settlement_status', s.settlement_status, 'paid_at', s.paid_at,
            'requires_photo', s.requires_photo, 'retainage_withheld', s.retainage_withheld,
            'is_retainage_release', s.is_retainage_release,
            'method', (select m.name from public.payment_methods m where m.id = s.payment_method_id),
            'evidence', public.fin_evidence(null, s.id),
            'settlement', (select jsonb_build_object('reference', st.provider_reference, 'status', st.status,
                                    'paid_on', st.paid_on, 'amount', st.contractor_amount,
                                    'method', (select m.name from public.payment_methods m where m.id = st.payment_method_id))
                             from public.stage_settlements st where st.payment_stage_id = s.id
                            order by st.created_at desc limit 1),
            'transaction', (select jsonb_build_object('id', t.id, 'status', t.status, 'amount', t.amount, 'paid_on', t.paid_on,
                                     'reference', t.payment_reference,
                                     'confirm_task', (select a.id from public.actions a
                                                       where a.source = 'system:transaction:' || t.id::text
                                                         and a.status not in ('Completed','Cancelled','Force Cancelled') limit 1))
                              from public.transactions t where t.payment_stage_id = s.id
                             order by t.created_at desc limit 1)
          ) order by s.sequence_no nulls last, s.created_at), '[]'::jsonb)
          from public.payment_stages s where s.contract_id = c.id),
        'transactions', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', t.id, 'description', t.description, 'amount', t.amount, 'paid_on', t.paid_on, 'status', t.status,
            'moved', coalesce(ts.means_money_moved, t.amount is not null and t.paid_on is not null),
            'reference', t.payment_reference, 'invoice', t.invoice_reference,
            'method', coalesce((select m.name from public.payment_methods m where m.id = t.payment_method_id), t.paid_via),
            'stage_id', t.payment_stage_id, 'change_order', t.contract_id <> c.id,
            'target_amount', t.target_amount, 'target_date', t.target_date,
            'attachments', (select coalesce(jsonb_agg(jsonb_build_object('file_id', f.id, 'file_name', f.file_name, 'kind', f.kind,
                                                                         'bucket', f.bucket, 'path', f.path)), '[]'::jsonb)
                              from public.files f where f.project_id = t.project_id
                               and f.path like '%/payments/' || t.id::text || '/%')
          ) order by t.paid_on desc nulls last, t.created_at desc), '[]'::jsonb)
          from public.transactions t
          left join public.transaction_statuses ts on ts.status = t.status and ts.direction in (t.direction, 'both')
          where t.contract_id = c.id
             or t.contract_id in (select co.id from public.contracts co where co.parent_contract_id = c.id)),
        'totals', jsonb_build_object(
          'agreed', coalesce(c.amount, 0) + coalesce((select sum(co.amount) from public.contracts co
                       where co.parent_contract_id = c.id
                         and co.status in ('approved','signed','active','Active','awarded','Complete','verbal')), 0),
          'paid', coalesce((select sum(t.amount) from public.transactions t
                              left join public.transaction_statuses ts on ts.status = t.status and ts.direction in (t.direction, 'both')
                             where (t.contract_id = c.id or t.contract_id in (select co.id from public.contracts co where co.parent_contract_id = c.id))
                               and t.direction = 'out'
                               and coalesce(ts.means_money_moved, t.amount is not null and t.paid_on is not null)), 0),
          'retained', coalesce((select sum(s.retainage_withheld) from public.payment_stages s
                                 where s.contract_id = c.id and s.settlement_status = 'paid' and not s.is_retainage_release), 0),
          'requested', coalesce((select sum(co.amount) from public.contracts co
                                  where co.parent_contract_id = c.id and co.status = 'requested'), 0))
      ) as j
    from public.contracts c
    join public.projects p on p.id = c.project_id
    where c.project_id in (select project_id from public.fin_family(p_project))
      and c.parent_contract_id is null
      and c.direction = 'payable'
      and (c.status <> 'placeholder'
           or exists (select 1 from public.transactions t where t.contract_id = c.id)
           or exists (select 1 from public.payment_stages s where s.contract_id = c.id))
      and (v_all or public.fin_is_payee(c.id))
  ) x;

  select coalesce(sum((e->'totals'->>'agreed')::numeric), 0), coalesce(sum((e->'totals'->>'paid')::numeric), 0),
         coalesce(sum((e->'totals'->>'retained')::numeric), 0), coalesce(sum((e->'totals'->>'requested')::numeric), 0)
    into v_agreed, v_paid, v_retained, v_requested
    from jsonb_array_elements(v_contracts) e;

  if v_all then
    -- A package booked but not yet accepted: its stages exist with no
    -- contract behind them (help topic payments, "the homeowner case").
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', s.name, 'sequence_no', s.sequence_no, 'amount', s.amount,
             'percent', s.percent_of_contract, 'status', s.status, 'settlement_status', s.settlement_status,
             'project', jsonb_build_object('id', p.id, 'name', p.project_name))
             order by p.project_name, s.sequence_no), '[]'::jsonb)
      into v_unassigned
      from public.payment_stages s join public.projects p on p.id = s.project_id
     where s.project_id in (select project_id from public.fin_family(p_project)) and s.contract_id is null;

    -- Project costs with no contract behind them - the lumber yard, the
    -- permit fee (rulebook 50: never invent a contract to satisfy a key).
    select coalesce(sum(t.amount) filter (where coalesce(ts.means_money_moved, t.amount is not null and t.paid_on is not null)), 0),
           jsonb_build_object(
             'count', count(*),
             'rows', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', r.id, 'description', r.description, 'amount', r.amount, 'paid_on', r.paid_on, 'status', r.status,
                        'method', coalesce((select m.name from public.payment_methods m where m.id = r.payment_method_id), r.paid_via),
                        'category', (select b.category from public.budget_categories b where b.id = r.budget_category_id),
                        'project', (select q.project_name from public.projects q where q.id = r.project_id))
                        order by r.paid_on desc nulls last, r.created_at desc)
                      from (select * from public.transactions z
                             where z.project_id in (select project_id from public.fin_family(p_project))
                               and z.contract_id is null and z.direction = 'out'
                             order by z.paid_on desc nulls last, z.created_at desc limit 12) r), '[]'::jsonb))
      into v_other_paid, v_other
      from public.transactions t
      left join public.transaction_statuses ts on ts.status = t.status and ts.direction in (t.direction, 'both')
     where t.project_id in (select project_id from public.fin_family(p_project))
       and t.contract_id is null and t.direction = 'out';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'requires_reference', m.requires_reference)
           order by m.display_order nulls last, m.name), '[]'::jsonb)
    into v_methods
    from public.payment_methods m where m.is_active and m.settlement_type = 'manual';

  return jsonb_build_object(
    'ok', true,
    'project', jsonb_build_object('id', pr.id, 'name', pr.project_name, 'address', pr.address, 'status', pr.status,
                                  'parent_project_id', pr.parent_project_id),
    'me', jsonb_build_object('rank', v_rank, 'may_record', v_rec, 'all', v_all, 'contact_id', v_contact, 'name', v_name,
                             'is_superadmin', public.is_superadmin()),
    'totals', jsonb_build_object('agreed', v_agreed, 'paid', v_paid, 'outstanding', v_agreed - v_paid,
                                 'retained', v_retained, 'requested', v_requested, 'other_paid', v_other_paid),
    'contracts', v_contracts,
    'unassigned_stages', v_unassigned,
    'other_costs', v_other,
    'methods', v_methods);
end $$;

-- ---------------------------------------------------------------------------
-- THE WRITES. Each one answers {ok, reason} rather than raising, so the
-- screen can say what happened in a sentence.
-- ---------------------------------------------------------------------------

-- A milestone on a contract: the payor side sets up the schedule.
create or replace function public.payment_stage_save(
  p_contract uuid, p_name text, p_amount numeric,
  p_percent numeric default null, p_due_on date default null, p_trigger text default null, p_id uuid default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare me uuid := public.current_app_user_id(); c public.contracts; s public.payment_stages; v_id uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into c from public.contracts where id = p_contract;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'No such contract.'); end if;
  if not public.fin_may_record(c.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Only the owner side sets up payments on this project.');
  end if;
  if nullif(btrim(p_name), '') is null then return jsonb_build_object('ok', false, 'reason', 'Name the milestone.'); end if;
  if p_amount is null and p_percent is null then return jsonb_build_object('ok', false, 'reason', 'Give it an amount or a percent of the contract.'); end if;
  if p_amount is not null and p_amount <= 0 then return jsonb_build_object('ok', false, 'reason', 'The amount has to be above zero.'); end if;

  if p_id is null then
    insert into public.payment_stages (project_id, contract_id, name, sequence_no, amount, percent_of_contract,
                                       trigger_description, due_on, status, created_by_user_id)
    values (c.project_id, c.id, btrim(p_name),
            coalesce((select max(x.sequence_no) from public.payment_stages x where x.contract_id = c.id), 0) + 1,
            p_amount, p_percent, nullif(btrim(p_trigger), ''), p_due_on, 'Planned', me)
    returning id into v_id;
  else
    select * into s from public.payment_stages where id = p_id and contract_id = c.id;
    if s.id is null then return jsonb_build_object('ok', false, 'reason', 'No such milestone on this contract.'); end if;
    if s.settlement_status = 'paid' or s.status = 'Paid' then
      return jsonb_build_object('ok', false, 'reason', 'This milestone is paid; the record stands.');
    end if;
    update public.payment_stages
       set name = btrim(p_name), amount = p_amount, percent_of_contract = p_percent,
           trigger_description = nullif(btrim(p_trigger), ''), due_on = p_due_on
     where id = s.id;
    v_id := s.id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.payment_stage_delete(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare me uuid := public.current_app_user_id(); s public.payment_stages;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into s from public.payment_stages where id = p_id;
  if s.id is null then return jsonb_build_object('ok', false, 'reason', 'No such milestone.'); end if;
  if not public.fin_may_record(s.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Only the owner side changes the payment schedule.');
  end if;
  if s.status <> 'Planned' or s.settlement_status <> 'not_started'
     or exists (select 1 from public.transactions t where t.payment_stage_id = s.id) then
    return jsonb_build_object('ok', false, 'reason', 'Only a planned milestone with nothing recorded against it can be removed. Cancel it instead.');
  end if;
  delete from public.payment_stages where id = s.id;
  return jsonb_build_object('ok', true);
end $$;

-- Moving a milestone along its line. The payee asks for it (Requested);
-- the payor readies, approves, cancels or takes it back to Planned; either
-- side may dispute. Paid is never set here - only the settlement path does.
create or replace function public.payment_stage_set(p_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id(); s public.payment_stages;
  v_rec boolean; v_payee boolean;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into s from public.payment_stages where id = p_id;
  if s.id is null then return jsonb_build_object('ok', false, 'reason', 'No such milestone.'); end if;
  if s.settlement_status = 'paid' or s.status = 'Paid' then
    return jsonb_build_object('ok', false, 'reason', 'This milestone is paid; the record stands.');
  end if;
  v_rec   := public.fin_may_record(s.project_id);
  v_payee := s.contract_id is not null and public.fin_is_payee(s.contract_id);

  if p_status = 'Requested' then
    if not (v_payee or v_rec) then return jsonb_build_object('ok', false, 'reason', 'Only the contractor on this contract requests a payment.'); end if;
    if s.status not in ('Planned','Ready') then return jsonb_build_object('ok', false, 'reason', format('It is already %s.', s.status)); end if;
  elsif p_status in ('Ready','Approved','Cancelled','Planned') then
    if not v_rec then return jsonb_build_object('ok', false, 'reason', 'Only the owner side does that.'); end if;
    if p_status = 'Approved' and s.status not in ('Planned','Ready','Requested') then
      return jsonb_build_object('ok', false, 'reason', format('It is %s, not waiting for approval.', s.status));
    end if;
  elsif p_status = 'Disputed' then
    if not (v_payee or v_rec) then return jsonb_build_object('ok', false, 'reason', 'Only a party to this contract disputes a milestone.'); end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'Not a status a person sets.');
  end if;

  update public.payment_stages
     set status = p_status,
         approved_by_user_id = case when p_status = 'Approved' then me else approved_by_user_id end,
         approved_at         = case when p_status = 'Approved' then now() else approved_at end
   where id = s.id;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- A file, already uploaded through record_project_file, hung on a milestone
-- or a contract. Photos are evidence, documents are invoices (a receipt, a
-- quote for the extra material), the rest is reference. Like file_attach:
-- the file keeps exactly one link, this one.
create or replace function public.fin_evidence_attach(p_file_id uuid, p_stage uuid default null, p_contract uuid default null, p_role text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id(); f public.files; s public.payment_stages; c public.contracts; v_role text;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if (p_stage is null) = (p_contract is null) then return jsonb_build_object('ok', false, 'reason', 'Attach it to one milestone or one contract.'); end if;
  select * into f from public.files where id = p_file_id;
  if f.id is null then return jsonb_build_object('ok', false, 'reason', 'No such file.'); end if;
  if f.uploaded_by_user_id is distinct from me and not public.can_see_file(f.id) then
    return jsonb_build_object('ok', false, 'reason', 'That file is not yours.');
  end if;

  if p_stage is not null then
    select * into s from public.payment_stages where id = p_stage;
    if s.id is null then return jsonb_build_object('ok', false, 'reason', 'No such milestone.'); end if;
    if s.project_id is distinct from f.project_id then return jsonb_build_object('ok', false, 'reason', 'That file belongs to another project.'); end if;
    if not (public.fin_may_record(s.project_id)
            or (s.contract_id is not null and public.fin_is_payee(s.contract_id))
            or (s.contract_id is null and public.is_project_member(s.project_id))) then
      return jsonb_build_object('ok', false, 'reason', 'This milestone is not yours to document.');
    end if;
  else
    select * into c from public.contracts where id = p_contract;
    if c.id is null then return jsonb_build_object('ok', false, 'reason', 'No such contract.'); end if;
    if c.project_id is distinct from f.project_id then return jsonb_build_object('ok', false, 'reason', 'That file belongs to another project.'); end if;
    if not (public.fin_may_record(c.project_id) or public.fin_is_payee(c.id)) then
      return jsonb_build_object('ok', false, 'reason', 'This contract is not yours to document.');
    end if;
  end if;

  v_role := coalesce(nullif(btrim(p_role), ''),
                     case when f.kind = 'photo' then 'evidence'
                          when f.kind = 'document' then 'invoice'
                          else 'reference' end);
  if v_role not in ('before','after','evidence','progress','invoice','drawing','reference') then
    return jsonb_build_object('ok', false, 'reason', 'Not a role a file can carry here.');
  end if;

  delete from public.file_links where file_id = f.id;
  insert into public.file_links (file_id, payment_stage_id, contract_id, role, created_by_user_id)
  values (f.id, p_stage, p_contract, v_role, me);
  return jsonb_build_object('ok', true, 'file_id', f.id, 'role', v_role);
end $$;

-- Money moved, recorded by the payor: the one write path (rulebook 52),
-- with the evidence attached first so the photo gate is met, and the stage
-- approved by the act of paying it. Refusals come back as a sentence.
create or replace function public.fin_payment_record(
  p_stage uuid, p_method uuid, p_reference text default null, p_amount numeric default null,
  p_paid_on date default null, p_cleared boolean default true, p_from_account text default null,
  p_notes text default null, p_file_ids uuid[] default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id(); s public.payment_stages; st public.stage_settlements; f uuid; r jsonb;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into s from public.payment_stages where id = p_stage;
  if s.id is null then return jsonb_build_object('ok', false, 'reason', 'No such milestone.'); end if;
  if not public.fin_may_record(s.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Only the owner side records a payment.');
  end if;
  if s.contract_id is null then
    return jsonb_build_object('ok', false, 'reason', 'Nobody holds this job yet, so there is no one to pay.');
  end if;
  if p_amount is not null and p_amount <= 0 then return jsonb_build_object('ok', false, 'reason', 'The amount has to be above zero.'); end if;

  if p_file_ids is not null then
    foreach f in array p_file_ids loop
      r := public.fin_evidence_attach(f, s.id, null, null);
      if not (r->>'ok')::boolean then return r; end if;
    end loop;
  end if;

  if s.status in ('Planned','Ready','Requested') then
    update public.payment_stages set status = 'Approved', approved_by_user_id = me, approved_at = now() where id = s.id;
  end if;

  begin
    st := public.record_manual_payment(s.id, p_method, nullif(btrim(p_reference), ''), p_amount, coalesce(p_paid_on, current_date),
                                       coalesce(p_cleared, true), nullif(btrim(p_from_account), ''), nullif(btrim(p_notes), ''));
  exception when others then
    return jsonb_build_object('ok', false, 'reason', regexp_replace(sqlerrm, '^[A-Z_]+: ', ''));
  end;

  return jsonb_build_object('ok', true, 'stage_id', s.id, 'settlement_id', st.id, 'transaction_id', st.transaction_id,
                            'cleared', coalesce(p_cleared, true));
end $$;

-- The payee says the money landed. The ledger row already spawned an
-- "awaiting confirmation" task (fn_transactions_notify_task); closing it
-- is what moves the transaction to "paid - receipt filed".
create or replace function public.fin_receipt_confirm(p_stage uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare me uuid := public.current_app_user_id(); s public.payment_stages; t public.transactions; a uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into s from public.payment_stages where id = p_stage;
  if s.id is null then return jsonb_build_object('ok', false, 'reason', 'No such milestone.'); end if;
  if s.contract_id is null or not public.fin_is_payee(s.contract_id) then
    return jsonb_build_object('ok', false, 'reason', 'Only the contractor who was paid confirms it.');
  end if;
  select * into t from public.transactions where payment_stage_id = s.id order by created_at desc limit 1;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'No payment is recorded on this milestone yet.'); end if;

  select x.id into a from public.actions x
   where x.source = 'system:transaction:' || t.id::text
     and x.status not in ('Completed','Cancelled','Force Cancelled') limit 1;
  if a is not null then
    perform public.close_action(a, true, 'portal:financials', 'Completed', false);
  end if;
  update public.transactions set status = 'paid - receipt filed', last_modified_by = 'portal:financials'
   where id = t.id and status in ('paid', 'paid - pending confirmation');
  return jsonb_build_object('ok', true, 'transaction_id', t.id);
end $$;

-- AN ADDITION. The contractor asks for more - material, an extra the scope
-- did not carry - or the owner records one they agreed on site. It is a
-- change order: a contract under the one it changes, a scope line under
-- that contract so it is captured against the work, the evidence on it,
-- and (when the contractor asked) a decision task for the owner.
create or replace function public.change_order_request(
  p_contract uuid, p_title text, p_amount numeric,
  p_scope text default null, p_reason text default null, p_file_ids uuid[] default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id(); c public.contracts; pr public.projects;
  v_rec boolean; v_payee boolean; v_status text; v_name text; v_contact uuid; v_owner_contact uuid;
  v_id uuid; f uuid; r jsonb; v_title text;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into c from public.contracts where id = p_contract;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'No such contract.'); end if;
  if c.parent_contract_id is not null then return jsonb_build_object('ok', false, 'reason', 'Ask for the change on the main contract, not on another change.'); end if;
  v_rec   := public.fin_may_record(c.project_id);
  v_payee := public.fin_is_payee(c.id);
  if not (v_rec or v_payee) then return jsonb_build_object('ok', false, 'reason', 'This contract is not yours.'); end if;
  v_title := nullif(btrim(p_title), '');
  if v_title is null then return jsonb_build_object('ok', false, 'reason', 'Say what the change is.'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'reason', 'How much more does it cost?'); end if;

  select u.contact_id, coalesce(u.full_name, u.email) into v_contact, v_name from public.app_users u where u.id = me;
  select * into pr from public.projects where id = c.project_id;
  -- The owner side recording an agreed extra approves it in the same act;
  -- the contractor asking for one waits for the decision.
  v_status := case when v_rec then 'approved' else 'requested' end;

  insert into public.contracts
    (title, contract_type, status, direction, project_id, trade, amount, currency,
     contractor_id, counterparty_company_id, counterparty_contact_id, signer_company_id, signer_contact_id,
     default_payment_method_id, net_days, consumables_by, finish_material_by, retainage_pct, budget_category_id,
     parent_contract_id, scope, awarded_date, created_by, last_modified_by, notes)
  values
    (v_title, 'change order', v_status, c.direction, c.project_id, c.trade, p_amount, coalesce(c.currency, 'USD'),
     c.contractor_id, c.counterparty_company_id, c.counterparty_contact_id, c.signer_company_id, c.signer_contact_id,
     c.default_payment_method_id, c.net_days, c.consumables_by, c.finish_material_by, coalesce(c.retainage_pct, 0), c.budget_category_id,
     c.id, nullif(btrim(p_scope), ''), case when v_rec then current_date end, 'portal:financials', 'portal:financials',
     format('%s by %s on %s.', case when v_rec then 'Recorded' else 'Requested' end, v_name, to_char(now(), 'YYYY-MM-DD'))
       || coalesce(E'\n' || nullif(btrim(p_reason), ''), ''))
  returning id into v_id;

  -- Captured against the scope of work delivered: a line under the parent
  -- contract, carrying the change that authorises it.
  insert into public.project_scope_items
    (project_id, trade, item, category, source, is_required, add_to_contract, add_to_checklist, origin,
     contract_id, change_order_id, authority, owner_summary, audience, notes, created_by)
  values
    (c.project_id, coalesce(c.trade, 'General'), v_title, 'Change order', 'change order', true, true, true, 'project',
     c.id, v_id, 'change order', nullif(btrim(p_scope), ''), 'both', nullif(btrim(p_reason), ''), 'portal:financials');

  if p_file_ids is not null then
    foreach f in array p_file_ids loop
      r := public.fin_evidence_attach(f, null, v_id, null);
      if not (r->>'ok')::boolean then return r; end if;
    end loop;
  end if;

  if v_rec then
    -- Agreed already: it can be paid, through one milestone of its own.
    insert into public.payment_stages (project_id, contract_id, name, sequence_no, amount, percent_of_contract,
                                       trigger_description, status, created_by_user_id)
    values (c.project_id, v_id, 'Change: ' || v_title, 1, p_amount, 100, 'When the change is delivered', 'Planned', me);
  else
    -- The owner decides. One task, on the unified list, assigned to whoever
    -- owns the project (the property's owner reaches its jobs).
    select u.contact_id into v_owner_contact
      from public.project_ancestry(c.project_id) a
      join public.projects p on p.id = a.project_id
      join public.app_users u on u.id = p.owner_user_id
     where p.owner_user_id is not null
     order by (p.id = c.project_id) desc limit 1;
    insert into public.actions
      (action, status, priority, domain, project_id, contract_id, assigned_to_contact_id, assigned_by_contact_id,
       is_gate, source, created_by, last_modified_by, desired_outcome, notes)
    values
      (format('Decide: %s (+$%s) on %s', v_title, to_char(p_amount, 'FM999,999,990.00'), coalesce(c.title, 'the contract')),
       'Not Started', 'High', coalesce(pr.domain, 'construction'), c.project_id, v_id,
       v_owner_contact, v_contact, true, 'system:change-order:' || v_id::text, 'portal:financials', 'portal:financials',
       'Approve or decline the change on the project money page. Approving it adds one payment milestone for the amount.',
       format('CHANGE ORDER REQUESTED by %s on %s.', v_name, to_char(now(), 'YYYY-MM-DD')) || E'\n'
         || 'Contract: ' || coalesce(c.title, '') || E'\n'
         || 'Amount: $' || to_char(p_amount, 'FM999,999,990.00') || E'\n'
         || coalesce('Scope: ' || nullif(btrim(p_scope), '') || E'\n', '')
         || coalesce('Why: ' || nullif(btrim(p_reason), ''), ''));
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status);
end $$;

-- The decision. The owner side approves (one milestone appears) or
-- declines; the contractor may withdraw their own request.
create or replace function public.change_order_decide(p_contract uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id(); co public.contracts; v_rec boolean; v_name text; v_status text; a record;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into co from public.contracts where id = p_contract;
  if co.id is null or co.parent_contract_id is null then return jsonb_build_object('ok', false, 'reason', 'No such change order.'); end if;
  if co.status not in ('requested', 'declined', 'withdrawn') then
    return jsonb_build_object('ok', false, 'reason', format('This change is %s already.', co.status));
  end if;
  v_rec := public.fin_may_record(co.project_id);
  select coalesce(u.full_name, u.email) into v_name from public.app_users u where u.id = me;

  if v_rec then
    v_status := case when p_approve then 'approved' else 'declined' end;
  elsif public.fin_is_payee(co.id) and not p_approve and co.status = 'requested' then
    v_status := 'withdrawn';
  else
    return jsonb_build_object('ok', false, 'reason', 'Only the owner side decides a change.');
  end if;

  update public.contracts
     set status = v_status,
         awarded_date = case when v_status = 'approved' then current_date else awarded_date end,
         last_modified_by = 'portal:financials',
         notes = coalesce(notes, '') || E'\n' || format('[%s %s] %s', to_char(now(), 'YYYY-MM-DD'), v_name, initcap(v_status))
                 || coalesce(': ' || nullif(btrim(p_note), ''), '')
   where id = co.id;

  if v_status = 'approved' and not exists (select 1 from public.payment_stages s where s.contract_id = co.id) then
    insert into public.payment_stages (project_id, contract_id, name, sequence_no, amount, percent_of_contract,
                                       trigger_description, status, created_by_user_id)
    values (co.project_id, co.id, 'Change: ' || co.title, 1, co.amount, 100, 'When the change is delivered', 'Planned', me);
  end if;

  for a in select x.id from public.actions x
            where x.source = 'system:change-order:' || co.id::text
              and x.status not in ('Completed','Cancelled','Force Cancelled') loop
    perform public.close_action(a.id, true, 'portal:financials', case when v_status = 'approved' then 'Completed' else 'Cancelled' end, false);
  end loop;

  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- Grants: signed-in members call them; the functions decide the rest.
revoke all on function public.fin_family(uuid) from public, anon;
revoke all on function public.fin_is_payee(uuid) from public, anon;
revoke all on function public.fin_may_record(uuid) from public, anon;
revoke all on function public.fin_sees_all(uuid) from public, anon;
revoke all on function public.fin_evidence(uuid, uuid) from public, anon;
revoke all on function public.project_financials(uuid) from public, anon;
revoke all on function public.payment_stage_save(uuid, text, numeric, numeric, date, text, uuid) from public, anon;
revoke all on function public.payment_stage_delete(uuid) from public, anon;
revoke all on function public.payment_stage_set(uuid, text) from public, anon;
revoke all on function public.fin_evidence_attach(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.fin_payment_record(uuid, uuid, text, numeric, date, boolean, text, text, uuid[]) from public, anon;
revoke all on function public.fin_receipt_confirm(uuid) from public, anon;
revoke all on function public.change_order_request(uuid, text, numeric, text, text, uuid[]) from public, anon;
revoke all on function public.change_order_decide(uuid, boolean, text) from public, anon;
grant execute on function public.fin_family(uuid), public.fin_is_payee(uuid), public.fin_may_record(uuid),
  public.fin_sees_all(uuid), public.fin_evidence(uuid, uuid), public.project_financials(uuid),
  public.payment_stage_save(uuid, text, numeric, numeric, date, text, uuid), public.payment_stage_delete(uuid),
  public.payment_stage_set(uuid, text), public.fin_evidence_attach(uuid, uuid, uuid, text),
  public.fin_payment_record(uuid, uuid, text, numeric, date, boolean, text, text, uuid[]),
  public.fin_receipt_confirm(uuid), public.change_order_request(uuid, text, numeric, text, text, uuid[]),
  public.change_order_decide(uuid, boolean, text)
  to authenticated, service_role;

-- The how-to, beside the money entries.
insert into public.help (doc_type, topic, title, applies_to, sort_order, created_by, content)
values ('how_to', 'money',
  'Project financials page - a contract from a payment standpoint, for the payor, the payee, the investor and the owner (Shahar 2026-09-10)',
  'contracts, payment_stages, transactions, stage_settlements, file_links, project_scope_items, actions, project_financials, fin_*, change_order_*, payment_stage_*',
  130, 'claude',
  'BUILT 2026-09-10 (migration 057). One page per project - /home/project/<id>/money in the homeowner app, /pro/project/<id>/money in the Professionals app, the same shared screen (apps/shared/src/finance) - drawing ONE read, project_financials(project). Nothing structural was added; the page assembles what the tables already held.' || E'\n\n' ||
  'WHO SEES WHAT. fin_sees_all: can_view_project_financials (owner / manager seats - the payor) OR any active seat whose project_roles.sees_financials is true (Investor, Partner, asset owner, site GC) - the investor reads everything and writes nothing. fin_is_payee(contract): the counterparty (i_am_contract_party) or a contract-bounded seat at rank >= 30 on it - they see THEIR contract, its change orders, milestones and payments, nothing else. fin_may_record = can_view_project_financials: only the payor side sets up milestones, approves, records money, decides a change.' || E'\n\n' ||
  'THE READ. project_financials(project) covers the project AND everything beneath it (fin_family: a property and its jobs), payable contracts that are not bare placeholders, each with its change orders (child contracts), milestones (amount = stage amount or percent of the contract; evidence; the latest settlement; the ledger row and its open confirmation task), the ledger (transactions on the contract and its change orders; moved = transaction_statuses.means_money_moved), and totals: agreed = contract + approved changes, paid = money that moved, outstanding, retained (v_contract_retainage in effect), requested = changes awaiting a decision. Owner-side readers also get unassigned_stages (a package booked, nobody holding it yet) and other_costs (transactions with no contract - the lumber yard, the permit; rulebook 50). methods = the active manual rails for the record sheet. Amounts are DOLLARS as the tables hold them (the packages side is cents).' || E'\n\n' ||
  'THE LIFE OF A MILESTONE. payment_stage_save / payment_stage_delete (payor): the schedule. payment_stage_set(stage, status): Requested by the payee (the work is done, pay me), Ready / Approved / Cancelled / back to Planned by the payor, Disputed by either. Paid is never set by hand: fin_payment_record(stage, method, reference, amount, paid_on, cleared, from_account, notes, file_ids) attaches the evidence first (fin_evidence_attach - a photo of the check, the waiver, the receipt), approves the stage by the act of paying it, then calls record_manual_payment - the ONE write path of rulebook 52, so the settlement, the transaction and the platform charge are written exactly as before. Its refusals (a check with no number, no photo on a stage that requires one, no active billing plan on the project) come back as {ok:false, reason}. cleared=false records a check sent and not landed; call again with the same reference when it clears. The ledger row spawns the "awaiting confirmation" task (fn_transactions_notify_task) as always; fin_receipt_confirm(stage) is the payee pressing "I received it" - it closes that task, which moves the transaction to paid - receipt filed.' || E'\n\n' ||
  'THE ADDITION. change_order_request(contract, title, amount, scope, reason, file_ids): a contractor asking for more (materials, an extra) or the owner recording one agreed on site. It writes a contracts row of contract_type change order under the parent (terms copied down from it), a project_scope_items line under the parent with authority change order so the addition is captured against the scope of work delivered, the evidence on the change (photo, file, camera shot, voice note - the shared Evidence component uploads through record_project_file), and when the CONTRACTOR asked, a High-priority gate task "Decide: ..." on the unified list assigned to the project owner (source system:change-order:<id>). When the OWNER records it, it is approved in the same act. change_order_decide(change, approve, note): the payor approves (one payment stage appears for the amount, and the change joins the agreed total) or declines; the payee may withdraw their own request. Statuses: requested, approved, declined, withdrawn; older change orders written as signed / awarded count as approved.' || E'\n\n' ||
  'NOT DONE HERE, deliberately: card payments (the processor rail stays unwired), editing a contract''s terms, receivable contracts (an investor''s own loan reads elsewhere), and any change to the RLS helpers - the investor''s read lives in project_financials only, because widening can_view_project_financials touches every money table at once and is a rulebook decision.');

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
