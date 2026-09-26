-- 243 GREEN BERGEN IS PAID UPFRONT AND PAYS THE CONTRACTOR ON ACCEPTANCE
--
-- Shahar (2026-09-25), on 242: "we do not hold customers money; either the
-- customer pays the amount to the contractor and he pays us for the lead,
-- or, the customer pays us upfront and we pay the contractor upon accepting
-- the job." So green_bergen is not a per-milestone collection:
--
--   * A green_bergen package's payment terms are UPFRONT: every payment
--     milestone is due at booking (due_from = posted) and sits before
--     "Contractor accepted" on the progress line. package_terms_problem says
--     so, Admin > Packages shows it (admin_package.terms_problem), and a
--     package that breaks it cannot be booked.
--   * The homeowner records the upfront payment while the job is out (no
--     contract yet). Its two rows are written without a contract; when a
--     contractor accepts, the contract share row follows the stage onto the
--     new contract (fn_payment_stages_contract_follows).
--   * A contractor can accept only once the upfront payment is in.
--   * The payout falls due on acceptance: v_contractor_payouts_due lists a
--     stage once it has a contract, and record_contractor_payout refuses
--     until the job is accepted AND Green Bergen has confirmed the
--     homeowner's payment landed (the confirmation task closed, the ledger
--     row "paid - receipt filed").
--
-- "Edit per the type of engagement": a package milestone's words no longer
-- name who is paid ("..., paid to the contractor"); the screens name the
-- payee from the job's collected_by.
--
-- "Fix money page to show end user pricing": project_financials shows the
-- owner side of a package job at the end-user price - contract, stages,
-- settlements and payments, with the mark-up row counted on the contract
-- instead of under other costs. The contractor (the payee) still sees their
-- price. fin_view_markup / fin_marked.
--
-- And the advisor warning Shahar asked about: v_platform_fees_receivable
-- ran with its owner's rights and was granted to anon, so anyone holding the
-- public key could read every pending fee with its project name. It now runs
-- as the caller (platform_charges RLS: financial rights) and anon lost it.

-- ---- upfront terms ---------------------------------------------------------
create or replace function public.package_terms_problem(p_code text, p_price_cents integer)
returns text language plpgsql stable security definer set search_path to 'public' as $function$
declare v_fixed bigint; v_pct numeric; v_npct int; v_bad text; v_collected text; v_accepted int;
begin
  select m.name into v_bad from public.blueprint_package_milestones m
   where m.package_code = p_code and m.kind = 'payment' and m.percent_of_contract is null and m.amount_cents is null
   order by m.sequence_no limit 1;
  if v_bad is not null then return format('payment "%s" has no amount - give it a percent or a fixed amount', v_bad); end if;
  select coalesce(sum(m.amount_cents), 0), coalesce(sum(m.percent_of_contract), 0), count(m.percent_of_contract)
    into v_fixed, v_pct, v_npct
    from public.blueprint_package_milestones m where m.package_code = p_code and m.kind = 'payment';
  if v_fixed > p_price_cents then
    return format('the fixed payments ($%s) come to more than the price ($%s)', to_char(v_fixed / 100.0, 'FM999,999,990.00'), to_char(p_price_cents / 100.0, 'FM999,999,990.00'));
  end if;
  if v_npct > 0 and v_pct <> 100 then return format('the percent payments add up to %s%%, not 100%%', v_pct); end if;
  if v_npct = 0 and v_fixed > 0 and v_fixed <> p_price_cents then
    return format('the fixed payments ($%s) do not add up to the price ($%s) and no percent payment takes the rest',
                  to_char(v_fixed / 100.0, 'FM999,999,990.00'), to_char(p_price_cents / 100.0, 'FM999,999,990.00'));
  end if;
  -- Green Bergen collects upfront and pays the contractor on acceptance.
  select collected_by into v_collected from public.blueprint_packages where code = p_code;
  if v_collected = 'green_bergen' then
    select m.name into v_bad from public.blueprint_package_milestones m
     where m.package_code = p_code and m.kind = 'payment' and m.due_from <> 'posted' order by m.sequence_no limit 1;
    if v_bad is not null then
      return format('Green Bergen collects this package, so the homeowner pays upfront - payment "%s" has to be due at booking', v_bad);
    end if;
    select min(m.sequence_no) into v_accepted from public.blueprint_package_milestones m where m.package_code = p_code and m.kind = 'accepted';
    select m.name into v_bad from public.blueprint_package_milestones m
     where m.package_code = p_code and m.kind = 'payment' and v_accepted is not null and m.sequence_no > v_accepted order by m.sequence_no limit 1;
    if v_bad is not null then
      return format('Green Bergen collects this package upfront - move payment "%s" before "Contractor accepted" on the progress line', v_bad);
    end if;
  end if;
  return null;
end $function$;
revoke execute on function public.package_terms_problem(text, integer) from public, anon, authenticated;

-- ---- the contract share follows the stage onto the contract ---------------
create or replace function public.fn_payment_stages_contract_follows()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if NEW.contract_id is not null and OLD.contract_id is null then
    update public.transactions t
       set contract_id = NEW.contract_id
      from public.stage_settlements ss
     where ss.payment_stage_id = NEW.id and ss.direction = 'charge'
       and ss.transaction_id = t.id and t.contract_id is null;
  end if;
  return NEW;
end $function$;
revoke execute on function public.fn_payment_stages_contract_follows() from public, anon, authenticated;
drop trigger if exists trg_payment_stages_contract_follows on public.payment_stages;
create trigger trg_payment_stages_contract_follows after update of contract_id on public.payment_stages
  for each row execute function public.fn_payment_stages_contract_follows();

-- ---- what is owed the contractor, on acceptance ---------------------------
create or replace view public.v_contractor_payouts_due with (security_invoker = true) as
select s.project_id, p.project_name, s.id as payment_stage_id, s.name as milestone,
       ctr.id as contract_id, ctr.contractor_id, coalesce(k.person_name, k.name) as contractor,
       ch.contractor_amount as amount_due, ch.currency, ch.paid_on as collected_on,
       current_date - ch.paid_on as days_since_collected,
       po.status as payout_status, po.provider_reference as payout_reference,
       coalesce((select t.status = 'paid - receipt filed' from public.transactions t where t.id = ch.transaction_id), false) as receipt_confirmed,
       (select b.accepted_at from public.project_bookings b where b.project_id = s.project_id) as accepted_at
  from public.payment_stages s
  join public.projects p on p.id = s.project_id
  join public.contracts ctr on ctr.id = s.contract_id
  left join public.contacts k on k.id = ctr.contractor_id
  join lateral (select x.* from public.stage_settlements x
                 where x.payment_stage_id = s.id and x.direction = 'charge' and x.status in ('cleared','succeeded')
                 order by x.created_at desc limit 1) ch on true
  left join lateral (select y.* from public.stage_settlements y
                      where y.payment_stage_id = s.id and y.direction = 'payout'
                      order by (y.status in ('cleared','succeeded')) desc, y.created_at desc limit 1) po on true
 where public.stage_collected_by(s.project_id) = 'green_bergen'
   and (po.id is null or po.status not in ('cleared','succeeded'));
comment on view public.v_contractor_payouts_due is
  'What Green Bergen owes contractors (migrations 242, 243): the contractor share of every upfront payment on a green_bergen job a contractor has accepted, until record_contractor_payout clears it. receipt_confirmed = Green Bergen confirmed the homeowner''s payment landed; the payout waits for it.';

-- ---- the owner side of a package job reads at the end-user price ---------
-- The mark-up to apply to amounts on a contract for THIS viewer: the job's
-- rate when it is a package job and the viewer is not the contractor on the
-- contract; else 0. Not fin_is_payee: that is true for a superadmin and for
-- the homeowner who signed, and both see the homeowner's side.
-- p_contract null = the owner-side lists (unassigned stages).
create or replace function public.fin_view_markup(p_project uuid, p_contract uuid default null)
returns numeric language sql stable security definer set search_path to 'public' as $function$
  select coalesce((
    select bp.percent_rate from public.project_billing_plan bp
     where bp.project_id = p_project and bp.status = 'active'
       and bp.model = 'percent_of_milestone' and bp.fee_bearer = 'homeowner'
       and exists (select 1 from public.project_bookings b where b.project_id = p_project)
       and not exists (
         select 1 from public.contracts c
          where c.id = p_contract
            and (c.contractor_id = public.contact_id_for_app_user(public.current_app_user_id())
                 or exists (select 1 from public.project_members pm
                             where pm.contract_id = c.id and pm.app_user_id = public.current_app_user_id()
                               and pm.project_role = 'contractor' and pm.status = 'active')))
     order by bp.started_on desc nulls last limit 1), 0);
$function$;
create or replace function public.fin_marked(p_amount numeric, p_pct numeric)
returns numeric language sql immutable as $function$
  select p_amount + round(p_amount * coalesce(p_pct, 0) / 100, 2);
$function$;
revoke execute on function public.fin_view_markup(uuid, uuid) from public, anon;

-- ---- the leaking view -------------------------------------------------------
alter view public.v_platform_fees_receivable set (security_invoker = true);
revoke select on public.v_platform_fees_receivable from anon;
revoke select on public.v_contractor_payouts_due from anon;

-- ---- milestone words name no payee -------------------------------------------
update public.blueprint_package_milestones
   set trigger_description = btrim(regexp_replace(regexp_replace(regexp_replace(trigger_description,
         ', paid to the contractor', '', 'g'),
         'Paid to the contractor on completion', 'Due on completion', 'g'),
         'is due to the contractor', 'is due', 'g'))
 where trigger_description ~ '(paid to the contractor|Paid to the contractor|due to the contractor)';
update public.payment_stages s
   set trigger_description = btrim(regexp_replace(regexp_replace(regexp_replace(s.trigger_description,
         ', paid to the contractor', '', 'g'),
         'Paid to the contractor on completion', 'Due on completion', 'g'),
         'is due to the contractor', 'is due', 'g'))
  from public.projects p
 where p.id = s.project_id and p.status not like 'Closed%'
   and s.trigger_description ~ '(paid to the contractor|Paid to the contractor|due to the contractor)';

-- ---- the functions -----------------------------------------------------------
do $mig$
declare
  src text; n int;
  edits jsonb;
  e jsonb;
begin
  edits := jsonb_build_array(
    -- Admin > Packages shows what is wrong with the terms
    jsonb_build_object('fn', 'public.admin_package(text)',
      'a', '''promote'', p.promote, ''collected_by'', p.collected_by,',
      'b', '''promote'', p.promote, ''collected_by'', p.collected_by, ''terms_problem'', public.package_terms_problem(p.code, p.base_price_cents),'),
    -- the upfront payment has no contract yet
    jsonb_build_object('fn', 'public.stage_payment_quote(uuid,uuid)',
      'a', 'if s.contract_id is null then',
      'b', 'if s.contract_id is null and v_collected is distinct from ''green_bergen'' then'),
    jsonb_build_object('fn', 'public.settle_stage_internal(uuid,text,uuid,text,text,numeric,numeric,numeric,text,text,uuid,text,text,text,text,date,uuid,text,text,numeric)',
      'a', 'if s.contract_id is not null and st.transaction_id is null then',
      'b', 'if (s.contract_id is not null or v_collected = ''green_bergen'') and st.transaction_id is null then'),
    jsonb_build_object('fn', 'public.settle_stage_internal(uuid,text,uuid,text,text,numeric,numeric,numeric,text,text,uuid,text,text,text,text,date,uuid,text,text,numeric)',
      'a', 'values (coalesce(ctr.title, ''Milestone payment'') || '' - '' || s.name,',
      'b', 'values (coalesce(ctr.title, (select p.project_name from public.projects p where p.id = s.project_id), ''Milestone payment'') || '' - '' || s.name,'),
    jsonb_build_object('fn', 'public.settle_stage_internal(uuid,text,uuid,text,text,numeric,numeric,numeric,text,text,uuid,text,text,text,text,date,uuid,text,text,numeric)',
      'a', ''' Paid to Green Bergen, which pays the contractor their share.''',
      'b', ''' Paid to Green Bergen upfront; Green Bergen pays the contractor their share when they accept the job.'''),
    jsonb_build_object('fn', 'public.settle_stage_internal(uuid,text,uuid,text,text,numeric,numeric,numeric,text,text,uuid,text,text,text,text,date,uuid,text,text,numeric)',
      'a', 'The contractor''''s share is paid out separately (v_contractor_payouts_due).',
      'b', 'The contractor''''s share is paid out when a contractor accepts the job (v_contractor_payouts_due).'),
    -- the homeowner pays while the job is out
    jsonb_build_object('fn', 'public.homeowner_milestone_mark(uuid,text,text,text,uuid)',
      'a', 'if b.state = ''posted'' then return jsonb_build_object(''ok'', false, ''reason'', ''Wait for a contractor to accept first.''); end if;',
      'b', 'if b.state = ''posted'' and public.stage_collected_by(p_project) is distinct from ''green_bergen'' then return jsonb_build_object(''ok'', false, ''reason'', ''Wait for a contractor to accept first.''); end if;'),
    -- a contractor accepts once the upfront payment is in
    jsonb_build_object('fn', 'public.homeowner_offer_accept(uuid,uuid)',
      'a', 'if b.state <> ''posted'' then return jsonb_build_object(''ok'', false, ''code'', ''TAKEN'', ''reason'', ''This job is no longer open.''); end if;',
      'b', E'if b.state <> ''posted'' then return jsonb_build_object(''ok'', false, ''code'', ''TAKEN'', ''reason'', ''This job is no longer open.''); end if;\n  if public.stage_collected_by(p_project) = ''green_bergen'' and exists (\n       select 1 from public.payment_stages x where x.project_id = p_project and x.status <> ''Cancelled'' and x.settlement_status <> ''paid'') then\n    return jsonb_build_object(''ok'', false, ''code'', ''NOT_PAID_YET'',\n      ''reason'', ''The homeowner pays Green Bergen upfront on this job, and that payment is not in yet. It opens to accept as soon as it is.'');\n  end if;'),
    -- the payout waits for acceptance and a confirmed receipt
    jsonb_build_object('fn', 'public.record_contractor_payout(uuid,uuid,text,numeric,date,boolean,text)',
      'a', '  select * into ctr from public.contracts where id = s.contract_id;',
      'b', E'  if s.contract_id is null then\n    raise exception ''NOT_ACCEPTED_YET: no contractor has accepted % yet - Green Bergen pays the contractor when they accept the job'', s.name using errcode = ''P0001'';\n  end if;\n  if not exists (select 1 from public.transactions t where t.id = ch.transaction_id and t.status = ''paid - receipt filed'') then\n    raise exception ''NOT_CONFIRMED_YET: confirm the homeowner''''s payment for % landed with Green Bergen first - close its "Awaiting confirmation from Green Bergen" task'', s.name using errcode = ''P0001'';\n  end if;\n  select * into ctr from public.contracts where id = s.contract_id;'),
    -- the money page, owner side at the end-user price
    jsonb_build_object('fn', 'public.project_financials(uuid)',
      'a', '''amount'', c.amount, ''currency'', c.currency,',
      'b', '''amount'', public.fin_marked(c.amount, public.fin_view_markup(c.project_id, c.id)), ''currency'', c.currency,'),
    -- two halves of one expression: a function that does not parse cannot be created
    jsonb_build_object('fn', 'public.project_financials(uuid)',
      'a', '''amount'', coalesce(s.amount, case when s.percent_of_contract',
      'b', '''amount'', public.fin_marked(coalesce(s.amount, case when s.percent_of_contract',
      'a2', 'then round(c.amount * s.percent_of_contract / 100, 2) end),',
      'b2', 'then round(c.amount * s.percent_of_contract / 100, 2) end), public.fin_view_markup(c.project_id, c.id)),'),
    jsonb_build_object('fn', 'public.project_financials(uuid)',
      'a', '''paid_on'', st.paid_on, ''amount'', st.contractor_amount,',
      'b', '''paid_on'', st.paid_on, ''amount'', case when public.fin_view_markup(c.project_id, c.id) > 0 then st.gross_amount else st.contractor_amount end,'),
    jsonb_build_object('fn', 'public.project_financials(uuid)',
      'a', '''transaction'', (select jsonb_build_object(''id'', t.id, ''status'', t.status, ''amount'', t.amount,',
      'b', '''transaction'', (select jsonb_build_object(''id'', t.id, ''status'', t.status, ''amount'', case when public.fin_view_markup(c.project_id, c.id) > 0 then (select sum(t2.amount) from public.transactions t2 where t2.payment_stage_id = s.id) else t.amount end,'),
    jsonb_build_object('fn', 'public.project_financials(uuid)',
      'a', 'from public.transactions t where t.payment_stage_id = s.id',
      'b', 'from public.transactions t where t.payment_stage_id = s.id and t.contract_id is not distinct from s.contract_id'),
    jsonb_build_object('fn', 'public.project_financials(uuid)',
      'a', E'where t.contract_id = c.id\n             or t.contract_id in',
      'b', E'where (t.contract_id = c.id or (t.contract_id is null and public.fin_view_markup(c.project_id, c.id) > 0 and t.payment_stage_id in (select s2.id from public.payment_stages s2 where s2.contract_id = c.id)))\n             or t.contract_id in'),
    jsonb_build_object('fn', 'public.project_financials(uuid)',
      'a', '''agreed'', coalesce(c.amount, 0) +',
      'b', '''agreed'', public.fin_marked(coalesce(c.amount, 0), public.fin_view_markup(c.project_id, c.id)) +'),
    jsonb_build_object('fn', 'public.project_financials(uuid)',
      'a', 'where (t.contract_id = c.id or t.contract_id in',
      'b', 'where (t.contract_id = c.id or (t.contract_id is null and public.fin_view_markup(c.project_id, c.id) > 0 and t.payment_stage_id in (select s2.id from public.payment_stages s2 where s2.contract_id = c.id)) or t.contract_id in'),
    jsonb_build_object('fn', 'public.project_financials(uuid)',
      'a', 'and z.contract_id is null and z.source_account_id is not null',
      'b', 'and z.contract_id is null and z.source_account_id is not null and not exists (select 1 from public.payment_stages s3 where s3.id = z.payment_stage_id and s3.contract_id is not null)'),
    jsonb_build_object('fn', 'public.project_financials(uuid)',
      'a', 'and t.contract_id is null and t.source_account_id is not null;',
      'b', 'and t.contract_id is null and t.source_account_id is not null and not exists (select 1 from public.payment_stages s3 where s3.id = t.payment_stage_id and s3.contract_id is not null);'),
    jsonb_build_object('fn', 'public.project_financials(uuid)',
      'a', '''sequence_no'', s.sequence_no, ''amount'', s.amount,',
      'b', '''sequence_no'', s.sequence_no, ''amount'', public.fin_marked(s.amount, public.fin_view_markup(s.project_id, null)),')
  );
  for e in select * from jsonb_array_elements(edits) loop
    src := pg_get_functiondef((e->>'fn')::regprocedure);
    n := (length(src) - length(replace(src, e->>'a', ''))) / length(e->>'a');
    if n <> 1 then raise exception 'Migration 243: % matched % times in %, expected 1.', e->>'a', n, e->>'fn'; end if;
    src := replace(src, e->>'a', e->>'b');
    if e ? 'a2' then
      n := (length(src) - length(replace(src, e->>'a2', ''))) / length(e->>'a2');
      if n <> 1 then raise exception 'Migration 243: % matched % times in %, expected 1.', e->>'a2', n, e->>'fn'; end if;
      src := replace(src, e->>'a2', e->>'b2');
    end if;
    execute src;
  end loop;
end $mig$;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
