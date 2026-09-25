-- 242 THE HOMEOWNER PAYS ONE NUMBER, TO WHOEVER THE PACKAGE SAYS COLLECTS IT
--
-- Migration 240 let a package say who collects each milestone
-- (blueprint_packages.collected_by, frozen onto project_billing_plan.
-- collected_by at posting), but the recording path still assumed the
-- contractor was paid, at the contractor's stage amount. Asked which number
-- a contractor job records, Shahar (2026-09-25): "Update rulebook and align
-- all. Per package, payment terms are defined. Options include: number of
-- installments, amount and date per installment, milestone definition."
--
-- ALIGNED - every package job (a job with a booking), either flow:
--   the homeowner hands over the END-USER share of each milestone - the
--   stage amount (the contractor's share) plus the job's mark-up - and the
--   ledger records exactly that payment, split in two rows under one
--   reference so the contract still reads at the contractor's price:
--     row 1  the contract's share, on the contract, to whoever took the money
--     row 2  the mark-up, on the project, same payee, same reference
--   contractor    the homeowner paid the contractor; the mark-up is a PENDING
--                 platform_charges row the CONTRACTOR owes for the lead
--                 (platform_charges.owed_by_contact_id), listed in
--                 v_platform_fees_receivable.
--   green_bergen  the homeowner paid Green Bergen (config.platform_contact_id);
--                 the mark-up is a SUCCEEDED platform_charges row - kept at
--                 source - and Green Bergen owes the contractor their share:
--                 v_contractor_payouts_due until record_contractor_payout
--                 writes a 'payout' stage_settlements row.
--   The payout is Green Bergen's own money and is not a transactions row:
--   transactions is the project owner's ledger (rule 51), and counting the
--   payout there would count the same milestone twice. Green Bergen's side
--   lives where its fee already lives - stage_settlements and
--   platform_charges.
-- A project with no booking (the construction ledger, recorded by hand)
-- records exactly as before.
--
-- PAYMENT TERMS PER PACKAGE. blueprint_package_milestones already carried
-- the number of installments (one row per payment milestone) and the
-- milestone definition (name, trigger_description). Added: a FIXED amount
-- as the alternative to a percent (amount_cents, contractor-price cents -
-- the homeowner sees it marked up, like every other price), and a due date
-- per installment (due_days after due_from: the milestone being marked, the
-- contractor accepting, or the job being posted), stamped onto
-- payment_stages.due_on when its anchor happens. Fixed installments come off
-- the top; percents split the rest and must total 100; the last percent
-- installment takes the rounding, so the stages always add up to the price.
-- A package whose terms do not add up cannot be posted.
--
-- THREE BUGS THIS FIXES ON THE WAY, found building it:
--   * settle_stage_internal's ledger insert named no money account, so
--     trg_00_transactions_accounts (migration 087) refused it - no milestone
--     has ever settled (stage_settlements was empty). A package job now pays
--     from the homeowner's own account (homeowner_money_account); any other
--     project still names one or is refused with the trigger's sentence.
--   * provider_reference is unique across ALL settlements, and a manual
--     reference is a cheque number - two homeowners' check #101 would have
--     updated each other's settlement. A manual reference is now keyed to
--     its stage ('manual:<stage>:<ref>'); the ledger keeps the plain number.
--   * a repeated clearing call could write the fee twice; it cannot now.

-- ---- payment terms per package -----------------------------------------
alter table public.blueprint_package_milestones
  add column if not exists amount_cents integer check (amount_cents is null or amount_cents > 0),
  add column if not exists due_days integer not null default 0 check (due_days >= 0 and due_days <= 365),
  add column if not exists due_from text not null default 'milestone' check (due_from in ('milestone', 'accepted', 'posted'));
alter table public.blueprint_package_milestones drop constraint if exists blueprint_package_milestones_one_amount;
alter table public.blueprint_package_milestones add constraint blueprint_package_milestones_one_amount
  check (percent_of_contract is null or amount_cents is null);
comment on column public.blueprint_package_milestones.amount_cents is
  'A payment installment''s FIXED amount, in contractor-price cents (migration 242) - the alternative to percent_of_contract, never both. Fixed installments come off the top; percents split the rest. The homeowner sees it marked up.';
comment on column public.blueprint_package_milestones.due_days is
  'Days after due_from that a payment installment is due (migration 242). Stamped onto payment_stages.due_on when the anchor happens.';
comment on column public.blueprint_package_milestones.due_from is
  'What a payment installment''s due date counts from (migration 242): milestone (the homeowner marks it - the default), accepted (a contractor takes the job), posted (the job goes out).';

-- ---- who owes a fee, who Green Bergen is ----------------------------------
alter table public.platform_charges add column if not exists owed_by_contact_id uuid references public.contacts(id) on delete set null;
comment on column public.platform_charges.owed_by_contact_id is
  'Who owes this fee when it is PENDING (migration 242). On a package job the contractor collected, it is the contractor: the homeowner paid them the mark-up with the milestone and they owe it to Green Bergen for the lead. Null = the payer (the older reading).';

alter table public.config add column if not exists platform_contact_id uuid references public.contacts(id) on delete set null;
comment on column public.config.platform_contact_id is
  'The contact that IS Green Bergen (migration 242): the payee on a milestone Green Bergen collects (blueprint_packages.collected_by = green_bergen).';
update public.config set platform_contact_id = (
  select c.id from public.contacts c where c.name = 'Green Bergen' order by c.created_at limit 1)
 where platform_contact_id is null;

alter table public.stage_settlements drop constraint if exists stage_settlements_direction_check;
alter table public.stage_settlements add constraint stage_settlements_direction_check
  check (direction in ('charge', 'refund', 'payout'));
comment on column public.stage_settlements.direction is
  'charge = the payer paid the milestone; refund = it went back; payout = Green Bergen paid the contractor their share of a milestone it collected (migration 242, record_contractor_payout).';

-- ---- helpers ---------------------------------------------------------------
-- Who collects a project's milestones. The frozen copy on the plan; a
-- package job posted before 240 was the contractor's; anything else is not
-- a package job (null) and keeps the older recording.
create or replace function public.stage_collected_by(p_project uuid)
returns text language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    (select bp.collected_by from public.project_billing_plan bp
      where bp.project_id = p_project and bp.status = 'active' order by bp.started_on desc nulls last limit 1),
    case when exists (select 1 from public.project_bookings b where b.project_id = p_project) then 'contractor' end);
$function$;
revoke execute on function public.stage_collected_by(uuid) from public, anon;

-- The account a homeowner pays from: one per app user, found by an alias
-- that is the user, made the first time they record a payment. The kind is
-- unknown and stays 'other' until somebody says.
create or replace function public.homeowner_money_account(p_user uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_alias text; v_id uuid; u public.app_users;
begin
  if p_user is null then return null; end if;
  v_alias := 'app_user:' || p_user::text;
  select account_id into v_id from public.money_account_aliases where alias = v_alias;
  if v_id is not null then return v_id; end if;
  select * into u from public.app_users where id = p_user;
  insert into public.money_accounts (name, kind, owner, created_by, notes)
  values (coalesce(nullif(btrim(u.full_name), ''), u.email, 'Homeowner') || ' - own funds', 'other',
          coalesce(nullif(btrim(u.full_name), ''), u.email), 'homeowner-app',
          'The account a homeowner pays milestones from, made the first time they recorded one (migration 242). Kind unknown.')
  returning id into v_id;
  insert into public.money_account_aliases (alias, account_id, note)
  values (v_alias, v_id, 'The app user this account belongs to (migration 242).') on conflict (alias) do nothing;
  return v_id;
end $function$;
revoke execute on function public.homeowner_money_account(uuid) from public, anon, authenticated;

-- What is wrong with a package's payment terms at a price, or null.
create or replace function public.package_terms_problem(p_code text, p_price_cents integer)
returns text language plpgsql stable security definer set search_path to 'public' as $function$
declare v_fixed bigint; v_pct numeric; v_npct int; v_bad text;
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
  return null;
end $function$;

-- One installment's stage amount, in dollars, at a contractor price in
-- cents: its fixed amount, or its percent of what the fixed ones leave; the
-- last percent installment takes the rounding.
create or replace function public.package_stage_amount(p_code text, p_key text, p_price_cents integer)
returns numeric language plpgsql stable security definer set search_path to 'public' as $function$
declare v_rest bigint; v_last text; v_sum bigint := 0; r record; v_mine bigint;
begin
  select p_price_cents - coalesce(sum(m.amount_cents), 0) into v_rest
    from public.blueprint_package_milestones m where m.package_code = p_code and m.kind = 'payment';
  select m.key into v_last from public.blueprint_package_milestones m
   where m.package_code = p_code and m.kind = 'payment' and m.percent_of_contract is not null
   order by m.sequence_no desc limit 1;
  for r in select m.key, m.amount_cents, m.percent_of_contract from public.blueprint_package_milestones m
            where m.package_code = p_code and m.kind = 'payment' order by m.sequence_no loop
    v_mine := coalesce(r.amount_cents::bigint, round(v_rest * r.percent_of_contract / 100)::bigint);
    if r.key = p_key and r.key is distinct from v_last then return round(v_mine / 100.0, 2); end if;
    if r.key is distinct from v_last then v_sum := v_sum + v_mine; end if;
  end loop;
  if p_key = v_last then return round((p_price_cents - v_sum) / 100.0, 2); end if;
  return null;
end $function$;
revoke execute on function public.package_terms_problem(text, integer) from public, anon;
revoke execute on function public.package_stage_amount(text, text, integer) from public, anon;

-- ---- the quote -------------------------------------------------------------
create or replace function public.stage_payment_quote(p_stage_id uuid, p_payment_method_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  s         public.payment_stages;
  plan      public.project_billing_plan;
  ctr       public.contracts;
  payee     public.contacts;
  pm        public.payment_methods;
  acct      public.payee_accounts;
  base      numeric;
  retain    numeric := 0;
  payable   numeric;
  fee       numeric := 0;
  gross     numeric;
  net       numeric;
  fee_mode  text;
  blockers  text[] := '{}';
  v_collected text;
begin
  select * into s from public.payment_stages where id = p_stage_id;
  if s.id is null then
    raise exception 'NO_SUCH_STAGE: %', p_stage_id using errcode = '22023';
  end if;
  if not public.can_view_project_financials(s.project_id) then
    raise exception 'NOT_PERMITTED: you need financial rights on this project' using errcode = '42501';
  end if;

  select * into plan from public.project_billing_plan where project_id = s.project_id and status = 'active';
  select * into ctr  from public.contracts where id = s.contract_id;
  -- Who takes the milestone in (migration 242). Null = not a package job.
  v_collected := public.stage_collected_by(s.project_id);

  -- Method: explicit argument, then the stage, then what the CONTRACT agreed.
  select * into pm from public.payment_methods
   where id = coalesce(p_payment_method_id, s.payment_method_id, ctr.default_payment_method_id) and is_active;
  if pm.id is null then
    blockers := blockers || 'no payment method - set one on the contract or on this milestone'::text;
  end if;

  if s.is_retainage_release then
    -- The release stage pays out everything held back so far on this contract.
    select coalesce(sum(x.retainage_withheld), 0) into base
      from public.payment_stages x
     where x.contract_id = s.contract_id
       and x.settlement_status = 'paid'
       and not x.is_retainage_release;
    if base = 0 then
      blockers := blockers || 'nothing has been retained on this contract yet, so there is nothing to release'::text;
    end if;
  else
    base := coalesce(s.amount,
                     case when s.percent_of_contract is not null and ctr.amount is not null
                          then round(ctr.amount * s.percent_of_contract / 100, 2) end);
    if base is null then
      blockers := blockers || 'stage has neither an amount nor a percent of a priced contract'::text;
      base := 0;
    end if;
    retain := round(base * coalesce(ctr.retainage_pct, 0) / 100, 2);
  end if;

  payable := base - retain;

  -- The fee is taken on money that actually moves, so retainage is not charged
  -- twice - once when withheld and again when released.
  if plan.id is null then
    blockers := blockers || 'project has no active billing plan'::text;
  elsif plan.model = 'percent_of_milestone' then
    fee := round(payable * coalesce(plan.percent_rate, 0) / 100, 2);
    if plan.min_fee_amount is not null then fee := greatest(fee, plan.min_fee_amount); end if;
    if plan.max_fee_amount is not null then fee := least(fee, plan.max_fee_amount); end if;
  end if;

  if fee = 0 then
    fee_mode := 'none';
  elsif v_collected = 'green_bergen' then
    -- We take the whole milestone in and keep our share before paying out.
    fee_mode := 'retained';
  elsif coalesce(pm.supports_platform_fee, false) then
    fee_mode := 'automatic';
  else
    fee_mode := coalesce(plan.fee_collection_fallback, 'invoice');
    if fee_mode = 'waive' then
      fee := 0; fee_mode := 'waived';
    elsif fee_mode = 'block' then
      blockers := blockers || format(
        'plan requires the platform fee to ride the payment, and %s cannot carry one - use a card or bank debit', pm.name);
    end if;
  end if;

  -- The fee rides on top of what the payer hands over when it can: on a card
  -- (automatic), when we collect (retained), and - on a package job - when
  -- the contractor collects it with the milestone and owes it to us for the
  -- lead (invoice). Anything else pays the stage and is billed the fee.
  if fee_mode in ('automatic', 'retained') or (fee_mode = 'invoice' and v_collected is not null) then
    if plan.fee_bearer = 'contractor' then
      gross := payable;             net := payable - fee;
    elsif plan.fee_bearer = 'split' then
      gross := payable + round(fee * coalesce(plan.fee_split_homeowner_pct, 50) / 100, 2);
      net   := payable - (fee - round(fee * coalesce(plan.fee_split_homeowner_pct, 50) / 100, 2));
    else
      gross := payable + fee;       net := payable;
    end if;
  else
    gross := payable;               net := payable;
  end if;

  select * into payee from public.contacts where id = ctr.contractor_id;
  if pm.id is not null then
    select pa.* into acct from public.payee_accounts pa
     where pa.rail = pm.rail
       and (pm.provider is null or pa.provider is not distinct from pm.provider)
       and (pa.contact_id = payee.id or pa.company_id = payee.company_id)
       and pa.status <> 'retired'
     order by pa.is_default desc, pa.created_at
     limit 1;
  end if;

  if s.contract_id is null then
    blockers := blockers || 'stage is not attached to a contract, so there is no contractor to pay'::text;
  end if;
  if v_collected = 'green_bergen' and pm.settlement_type = 'processor' then
    blockers := blockers || format('Green Bergen collects this job, and taking %s into Green Bergen is not switched on yet - record a check, cash, Zelle or Venmo payment', pm.name);
  elsif pm.id is not null and coalesce(pm.requires_payee_account, false) then
    if acct.id is null then
      blockers := blockers || format('contractor has no %s account on file - they must complete onboarding first', pm.name);
    elsif not acct.payouts_enabled then
      blockers := blockers || format('contractor %s account cannot receive money yet (status %s)', pm.name, acct.status);
    end if;
  end if;
  if v_collected = 'green_bergen' and (select platform_contact_id from public.config limit 1) is null then
    blockers := blockers || 'Green Bergen collects this job, and config.platform_contact_id does not say which contact Green Bergen is'::text;
  end if;
  if s.status not in ('Approved','Ready','Requested') then
    blockers := blockers || format('stage status is %s - it must be Approved before it can be paid', s.status);
  end if;
  if s.settlement_status = 'paid' then
    blockers := blockers || 'stage is already paid'::text;
  end if;
  if s.requires_photo and not exists (
      select 1 from public.file_links fl where fl.payment_stage_id = s.id and fl.role in ('after','evidence')) then
    blockers := blockers || 'no photo evidence is attached to this milestone'::text;
  end if;

  return jsonb_build_object(
    'stage_id',               s.id,
    'project_id',             s.project_id,
    'contract_id',            s.contract_id,
    'stage_name',             s.name,
    'is_retainage_release',   s.is_retainage_release,
    'currency',               coalesce(plan.currency, 'usd'),
    'payment_method_id',      pm.id,
    'payment_method',         pm.name,
    'method_source',          case when p_payment_method_id is not null then 'argument'
                                   when s.payment_method_id is not null then 'stage'
                                   when ctr.default_payment_method_id is not null then 'contract'
                                   else 'none' end,
    'rail',                   pm.rail,
    'settlement_type',        pm.settlement_type,
    'provider',               pm.provider,
    'net_days',               ctr.net_days,
    'due_on',                 s.due_on,
    'milestone_value',        base,
    'retainage_pct',          coalesce(ctr.retainage_pct, 0),
    'retainage_withheld',     retain,
    'contractor_base_amount', payable,
    'platform_fee_amount',    fee,
    'fee_collection',         fee_mode,
    'fee_bearer',             plan.fee_bearer,
    'billing_model',          plan.model,
    'collected_by',           v_collected,
    'payee',                  case when v_collected = 'green_bergen' then 'green_bergen' else 'contractor' end,
    'payee_name',             case when v_collected = 'green_bergen' then 'Green Bergen' else coalesce(payee.person_name, payee.name) end,
    'charge_payer',           gross,
    'customer_amount',        gross,
    -- what lands with the payee from this payment: a card's fee is split off
    -- before it lands; otherwise the payee takes the whole of it in.
    'payee_receives',         case when fee_mode = 'automatic' then net else gross end,
    'pay_contractor',         net,
    'contractor_payout_due',  case when v_collected = 'green_bergen' then net else 0 end,
    'amount_minor_units',     (gross * 100)::bigint,
    'application_fee_minor',  case when fee_mode = 'automatic' then (fee * 100)::bigint else 0 end,
    'payee_account_id',       acct.id,
    'payee_account_ref',      coalesce(acct.external_account_id, acct.handle),
    'payee_display_name',     acct.display_name,
    'charge_mode',            case when pm.settlement_type = 'processor' then 'direct' else 'manual_record' end,
    'ok',                     (array_length(blockers, 1) is null),
    'blockers',               to_jsonb(blockers));
end $function$;

-- ---- the one write path ----------------------------------------------------
create or replace function public.settle_stage_internal(p_stage_id uuid, p_provider text, p_payment_method_id uuid, p_reference text, p_status text, p_gross numeric, p_contractor numeric, p_fee numeric, p_fee_collection text, p_currency text, p_payee_account_id uuid, p_payee_account_ref text, p_charge_reference text, p_fee_reference text, p_failure_message text, p_paid_on date, p_actor_user_id uuid, p_paid_from_account text, p_notes text, p_retainage numeric default 0)
returns public.stage_settlements language plpgsql security definer set search_path to 'public' as $function$
declare
  st      public.stage_settlements;
  s       public.payment_stages;
  ctr     public.contracts;
  pm      public.payment_methods;
  plan    public.project_billing_plan;
  txn_id  uuid;
  settled boolean;
  v_collected text;
  v_key     text;
  v_acct    uuid;
  v_gb      uuid;
  v_payee   uuid;
  v_markup  numeric := 0;
  v_share   numeric;
  v_party   text;
  v_prev    text;
  v_rail    text;
begin
  select * into s  from public.payment_stages  where id = p_stage_id;
  if s.id is null then
    raise exception 'NO_SUCH_STAGE: %', p_stage_id using errcode = '22023';
  end if;
  select * into pm from public.payment_methods where id = p_payment_method_id;
  select * into plan from public.project_billing_plan where project_id = s.project_id and status = 'active';
  v_collected := public.stage_collected_by(s.project_id);
  select platform_contact_id into v_gb from public.config limit 1;
  v_rail := coalesce(pm.name, p_provider);

  settled := p_status in ('succeeded','cleared');
  -- A manual reference is a cheque number - unique to one payer, not to the
  -- world - so its settlement key is scoped to the stage (migration 242).
  v_key := case when p_provider = 'manual' and p_reference is not null
                then 'manual:' || p_stage_id::text || ':' || p_reference else p_reference end;

  insert into public.stage_settlements (
      payment_stage_id, direction, provider, payment_method_id, charge_mode, currency,
      gross_amount, contractor_amount, application_fee_amount,
      payee_account_id, payee_account_ref, status, provider_reference,
      provider_charge_reference, provider_fee_reference, failure_message,
      paid_on, recorded_by_user_id, notes,
      authorized_at, captured_at, failed_at)
  values (p_stage_id, 'charge', p_provider, p_payment_method_id,
          case when coalesce(pm.settlement_type,'manual') = 'processor' then 'direct' else 'manual_record' end,
          p_currency, p_gross, p_contractor, coalesce(p_fee, 0),
          p_payee_account_id, p_payee_account_ref, p_status, v_key,
          p_charge_reference, p_fee_reference, p_failure_message,
          coalesce(p_paid_on, case when settled then current_date end), p_actor_user_id, p_notes,
          case when p_status in ('requires_capture','succeeded','cleared') then now() end,
          case when settled then now() end,
          case when p_status in ('failed','canceled') then now() end)
  on conflict (provider_reference) do update
     set status                    = excluded.status,
         provider_charge_reference = coalesce(excluded.provider_charge_reference, public.stage_settlements.provider_charge_reference),
         provider_fee_reference    = coalesce(excluded.provider_fee_reference, public.stage_settlements.provider_fee_reference),
         failure_message           = excluded.failure_message,
         paid_on                   = coalesce(public.stage_settlements.paid_on, excluded.paid_on),
         captured_at               = coalesce(public.stage_settlements.captured_at, excluded.captured_at),
         failed_at                 = coalesce(public.stage_settlements.failed_at, excluded.failed_at),
         last_modified_at          = now()
  returning * into st;

  if settled then
    select * into ctr from public.contracts where id = s.contract_id;

    if s.contract_id is not null and st.transaction_id is null then
      -- Whose money left: the account named, else - on a package job - the
      -- homeowner's own. Anything else names one or the ledger refuses it.
      v_acct := public.money_account_resolve(p_paid_from_account, s.project_id);
      if v_acct is null and v_collected is not null then
        v_acct := public.homeowner_money_account((select owner_user_id from public.projects where id = s.project_id));
      end if;

      if v_collected is null then
        -- Not a package job: the older recording, one row to the contractor.
        v_payee := ctr.contractor_id; v_share := p_contractor;
      else
        -- A package job: the payment as handed over, split so the contract
        -- reads at the contractor's price. The mark-up is the part of the fee
        -- the homeowner bears, when the fee rode on this payment.
        v_payee := case when v_collected = 'green_bergen' then v_gb else ctr.contractor_id end;
        if v_payee is null and v_collected = 'green_bergen' then
          raise exception 'NO_PLATFORM_CONTACT: Green Bergen collects this job, and config.platform_contact_id does not say which contact Green Bergen is'
            using errcode = 'P0001';
        end if;
        if p_fee_collection in ('automatic', 'retained', 'invoice') then
          v_markup := case plan.fee_bearer
                        when 'contractor' then 0
                        when 'split' then round(coalesce(p_fee, 0) * coalesce(plan.fee_split_homeowner_pct, 50) / 100, 2)
                        else coalesce(p_fee, 0) end;
        end if;
        v_markup := greatest(least(v_markup, p_gross), 0);
        v_share  := p_gross - v_markup;
      end if;

      insert into public.transactions (
        description, amount, paid_on, project_id, contract_id, contractor_id,
        payment_method_id, payment_reference, paid_from_account, source_account_id, status, payment_stage_id, notes)
      values (coalesce(ctr.title, 'Milestone payment') || ' - ' || s.name,
              v_share, coalesce(p_paid_on, current_date), s.project_id, s.contract_id, v_payee,
              p_payment_method_id, p_reference, p_paid_from_account, v_acct, 'paid', s.id,
              coalesce(p_notes, 'Milestone settled on the ' || v_rail || ' rail.')
                || case when v_collected = 'green_bergen'
                        then ' Paid to Green Bergen, which pays the contractor their share.' else '' end
                || case when v_markup > 0
                        then ' The same payment carried ' || v_markup::text || ' ' || upper(p_currency) || ' of Green Bergen''s mark-up, logged beside it.'
                        else '' end
                || case when coalesce(p_retainage, 0) > 0
                        then ' ' || p_retainage::text || ' ' || upper(p_currency) ||
                             ' retained per contract terms (' || coalesce(ctr.retainage_pct, 0)::text || '%).'
                        else '' end)
      returning id into txn_id;

      if v_markup > 0 then
        -- The receipt the payee confirms is for the whole payment, not the
        -- contract's share of it.
        update public.actions
           set action      = replace(action, '$' || to_char(v_share, 'FM999,999,999.00'), '$' || to_char(p_gross, 'FM999,999,999.00')),
               status_note = replace(status_note, '$' || to_char(v_share, 'FM999,999,999.00'), '$' || to_char(p_gross, 'FM999,999,999.00'))
         where source = 'system:transaction:' || txn_id::text;

        v_prev := coalesce(current_setting('sgr.skip_payment_notice', true), '');
        perform set_config('sgr.skip_payment_notice', '1', true);
        insert into public.transactions (
          description, amount, paid_on, project_id, contractor_id,
          payment_method_id, payment_reference, paid_from_account, source_account_id, status, payment_stage_id, notes)
        values ('Green Bergen mark-up - ' || s.name,
                v_markup, coalesce(p_paid_on, current_date), s.project_id,
                case when p_fee_collection = 'automatic' then v_gb else v_payee end,
                p_payment_method_id, p_reference, p_paid_from_account, v_acct, 'paid', s.id,
                case when v_collected = 'green_bergen'
                       then 'The mark-up on this milestone, paid to Green Bergen with it. Green Bergen keeps it.'
                     when p_fee_collection = 'automatic'
                       then 'The mark-up on this milestone, taken by the card rail as Green Bergen''s fee.'
                     else 'The mark-up on this milestone, paid to the contractor with it. The contractor owes it to Green Bergen for the lead.' end);
        perform set_config('sgr.skip_payment_notice', v_prev, true);
      end if;

      update public.stage_settlements set transaction_id = txn_id, last_modified_at = now()
       where id = st.id
      returning * into st;
    end if;

    if coalesce(p_fee, 0) > 0 and p_fee_collection in ('automatic','invoice','retained')
       and not exists (select 1 from public.platform_charges x
                        where x.payment_stage_id = s.id and x.kind = 'milestone_fee' and x.status <> 'refunded') then
      select coalesce(k.person_name, k.name) into v_party from public.contacts k where k.id = ctr.contractor_id;
      insert into public.platform_charges (
        project_id, billing_plan_id, payment_stage_id, kind, amount, currency,
        fee_bearer, status, provider, payment_method_id, provider_reference,
        provider_fee_reference, occurred_at, owed_by_contact_id, notes)
      select s.project_id, bp.id, s.id, 'milestone_fee', p_fee, p_currency,
             bp.fee_bearer,
             case when p_fee_collection in ('automatic','retained') then 'succeeded' else 'pending' end,
             p_provider, p_payment_method_id,
             case when p_fee_collection in ('automatic','retained') then v_key end,
             p_fee_reference, now(),
             case when p_fee_collection = 'invoice' and v_collected = 'contractor' then ctr.contractor_id end,
             case when p_fee_collection = 'retained'
                  then 'Green Bergen collected this milestone and kept its mark-up. The contractor''s share is paid out separately (v_contractor_payouts_due).'
                  when p_fee_collection = 'invoice' and v_collected = 'contractor'
                  then 'The homeowner paid ' || coalesce(v_party, 'the contractor') || ' the whole milestone on the ' || v_rail ||
                       ' rail, mark-up included. ' || coalesce(v_party, 'The contractor') || ' owes Green Bergen this mark-up for the lead - a RECEIVABLE to chase.'
                  when p_fee_collection = 'invoice'
                  then 'Milestone was paid on the ' || v_rail ||
                       ' rail, which cannot carry an application fee. This fee is a RECEIVABLE and must be billed separately.'
             end
      from public.project_billing_plan bp
      where bp.project_id = s.project_id and bp.status = 'active';
    end if;

    update public.payment_stages
       set settlement_status = 'paid', status = 'Paid',
           paid_at = now(), payment_method_id = coalesce(payment_method_id, p_payment_method_id),
           platform_fee_amount = coalesce(p_fee, 0),
           retainage_withheld = coalesce(p_retainage, 0),
           last_modified_at = now()
     where id = p_stage_id;

  elsif p_status = 'requires_capture' then
    update public.payment_stages set settlement_status = 'authorized', last_modified_at = now() where id = p_stage_id;
  elsif p_status = 'recorded' then
    update public.payment_stages
       set settlement_status = 'pending_clearance', status = 'Requested',
           payment_method_id = coalesce(payment_method_id, p_payment_method_id),
           retainage_withheld = coalesce(p_retainage, 0), last_modified_at = now()
     where id = p_stage_id;
  elsif p_status in ('failed','canceled') then
    update public.payment_stages set settlement_status = 'failed', last_modified_at = now() where id = p_stage_id;
  end if;

  return st;
end $function$;
revoke execute on function public.settle_stage_internal(uuid,text,uuid,text,text,numeric,numeric,numeric,text,text,uuid,text,text,text,text,date,uuid,text,text,numeric) from public, anon, authenticated;

-- ---- a person recording a payment -----------------------------------------
create or replace function public.record_manual_payment(p_stage_id uuid, p_payment_method_id uuid default null, p_reference text default null, p_amount numeric default null, p_paid_on date default null, p_cleared boolean default true, p_paid_from_account text default null, p_notes text default null)
returns public.stage_settlements language plpgsql security definer set search_path to 'public' as $function$
declare
  s   public.payment_stages;
  pm  public.payment_methods;
  q   jsonb;
  amt numeric;
  v_whole numeric; v_ratio numeric;
  v_contractor numeric; v_fee numeric;
begin
  select * into s from public.payment_stages where id = p_stage_id;
  if s.id is null then
    raise exception 'NO_SUCH_STAGE: %', p_stage_id using errcode = '22023';
  end if;
  if not public.can_view_project_financials(s.project_id) then
    raise exception 'NOT_PERMITTED: you need financial rights on this project' using errcode = '42501';
  end if;

  q := public.stage_payment_quote(p_stage_id, p_payment_method_id);
  select * into pm from public.payment_methods where id = (q->>'payment_method_id')::uuid;

  if pm.id is null then
    raise exception 'NO_METHOD: set a payment method on the contract or pass one' using errcode = '22023';
  end if;
  if pm.settlement_type = 'processor' then
    raise exception 'WRONG_ENTRY_POINT: % is collected in-app - use the payment flow, not a manual record', pm.name
      using errcode = 'P0001';
  end if;
  if pm.requires_reference and coalesce(p_reference, '') = '' then
    raise exception 'REFERENCE_REQUIRED: % needs a reference (%). Record it now - a payment without one cannot be reconciled later.',
      pm.name, coalesce(pm.notes, 'confirmation number') using errcode = 'P0001';
  end if;
  if not (q->>'ok')::boolean then
    raise exception 'STAGE_NOT_PAYABLE: %', array_to_string(
      array(select jsonb_array_elements_text(q->'blockers')), '; ') using errcode = 'P0001';
  end if;

  if q->>'collected_by' is null then
    -- Not a package job: as before, the amount is the contractor's.
    amt := coalesce(p_amount, (q->>'pay_contractor')::numeric);
    v_contractor := amt; v_fee := (q->>'platform_fee_amount')::numeric;
  else
    -- A package job: the homeowner hands over the end-user share. A part
    -- payment carries the same proportions.
    v_whole := (q->>'payee_receives')::numeric;
    amt := coalesce(p_amount, v_whole);
    v_ratio := case when v_whole > 0 then amt / v_whole else 1 end;
    v_contractor := round((q->>'pay_contractor')::numeric * v_ratio, 2);
    v_fee := round((q->>'platform_fee_amount')::numeric * v_ratio, 2);
  end if;

  return public.settle_stage_internal(
    p_stage_id, 'manual', pm.id,
    coalesce(p_reference, pm.name || ' ' || to_char(coalesce(p_paid_on, current_date), 'YYYY-MM-DD') || ' ' || left(p_stage_id::text, 8)),
    case when p_cleared then 'cleared' else 'recorded' end,
    amt, v_contractor, v_fee, q->>'fee_collection',
    q->>'currency', nullif(q->>'payee_account_id','')::uuid, q->>'payee_account_ref',
    null, null, null, coalesce(p_paid_on, current_date),
    public.current_app_user_id(), p_paid_from_account, p_notes,
    (q->>'retainage_withheld')::numeric);
end $function$;

-- ---- Green Bergen pays the contractor -------------------------------------
create or replace function public.record_contractor_payout(p_stage_id uuid, p_payment_method_id uuid, p_reference text default null, p_amount numeric default null, p_paid_on date default null, p_cleared boolean default true, p_notes text default null)
returns public.stage_settlements language plpgsql security definer set search_path to 'public' as $function$
declare
  s   public.payment_stages;
  ctr public.contracts;
  k   public.contacts;
  pm  public.payment_methods;
  acct public.payee_accounts;
  ch  public.stage_settlements;
  st  public.stage_settlements;
  v_ref text; v_key text; amt numeric; v_status text;
begin
  if not public.is_superadmin() then
    raise exception 'NOT_PERMITTED: only Green Bergen records a payout to a contractor' using errcode = '42501';
  end if;
  select * into s from public.payment_stages where id = p_stage_id;
  if s.id is null then raise exception 'NO_SUCH_STAGE: %', p_stage_id using errcode = '22023'; end if;
  if public.stage_collected_by(s.project_id) is distinct from 'green_bergen' then
    raise exception 'NOT_COLLECTED_BY_GREEN_BERGEN: the homeowner paid the contractor directly on this job, so Green Bergen has nothing to pay out'
      using errcode = 'P0001';
  end if;
  select * into ch from public.stage_settlements
   where payment_stage_id = s.id and direction = 'charge' and status in ('cleared','succeeded')
   order by created_at desc limit 1;
  if ch.id is null then
    raise exception 'NOT_COLLECTED_YET: the homeowner''s payment for % has not cleared, so there is nothing to pay out yet', s.name
      using errcode = 'P0001';
  end if;
  select * into ctr from public.contracts where id = s.contract_id;
  select * into k from public.contacts where id = ctr.contractor_id;
  select * into pm from public.payment_methods where id = p_payment_method_id and is_active;
  if pm.id is null then raise exception 'NO_METHOD: say how Green Bergen paid the contractor' using errcode = '22023'; end if;
  if pm.settlement_type = 'processor' then
    raise exception 'WRONG_ENTRY_POINT: % payouts are not wired - record the check, ACH, wire or Zelle that paid the contractor', pm.name
      using errcode = 'P0001';
  end if;
  v_ref := nullif(btrim(p_reference), '');
  if pm.requires_reference and v_ref is null then
    raise exception 'REFERENCE_REQUIRED: % needs a reference (%). A payout without one cannot be reconciled later.',
      pm.name, coalesce(pm.notes, 'confirmation number') using errcode = 'P0001';
  end if;
  v_key := 'payout:' || s.id::text || ':' || coalesce(v_ref, pm.name || ' ' || to_char(coalesce(p_paid_on, current_date), 'YYYY-MM-DD'));
  if exists (select 1 from public.stage_settlements x
              where x.payment_stage_id = s.id and x.direction = 'payout' and x.status in ('cleared','succeeded')
                and x.provider_reference <> v_key) then
    raise exception 'ALREADY_PAID_OUT: the contractor''s share of % is already recorded as paid', s.name using errcode = 'P0001';
  end if;
  select pa.* into acct from public.payee_accounts pa
   where pa.rail = pm.rail and (pa.contact_id = k.id or pa.company_id = k.company_id) and pa.status <> 'retired'
   order by pa.is_default desc, pa.created_at limit 1;

  amt := coalesce(p_amount, ch.contractor_amount);
  v_status := case when p_cleared then 'cleared' else 'recorded' end;

  insert into public.stage_settlements (
      payment_stage_id, direction, provider, payment_method_id, charge_mode, currency,
      gross_amount, contractor_amount, application_fee_amount, payee_account_id, payee_account_ref,
      status, provider_reference, paid_on, recorded_by_user_id, notes, authorized_at, captured_at)
  values (s.id, 'payout', 'manual', pm.id, 'manual_record', ch.currency,
          amt, amt, 0, acct.id, coalesce(acct.external_account_id, acct.handle),
          v_status, v_key, coalesce(p_paid_on, current_date), public.current_app_user_id(),
          coalesce(nullif(btrim(p_notes), ''),
                   'Green Bergen paid ' || coalesce(k.person_name, k.name, 'the contractor') || ' their share of ' || s.name ||
                   coalesce(' (' || pm.name || coalesce(' ' || v_ref, '') || ')', '') || '.'),
          now(), case when p_cleared then now() end)
  on conflict (provider_reference) do update
     set status = excluded.status,
         paid_on = coalesce(public.stage_settlements.paid_on, excluded.paid_on),
         captured_at = coalesce(public.stage_settlements.captured_at, excluded.captured_at),
         last_modified_at = now()
  returning * into st;
  return st;
end $function$;
revoke execute on function public.record_contractor_payout(uuid,uuid,text,numeric,date,boolean,text) from public, anon;
grant execute on function public.record_contractor_payout(uuid,uuid,text,numeric,date,boolean,text) to authenticated, service_role;

-- ---- what is owed, both ways ----------------------------------------------
create or replace view public.v_platform_fees_receivable as
 SELECT pc.project_id,
    p.project_name,
    pc.id AS charge_id,
    pc.payment_stage_id,
    s.name AS milestone,
    pm.name AS paid_on_rail,
    pc.amount,
    pc.currency,
    pc.fee_bearer,
    pc.occurred_at,
    CURRENT_DATE - pc.occurred_at::date AS days_outstanding,
    pc.owed_by_contact_id,
    coalesce(k.person_name, k.name) AS owed_by
   FROM platform_charges pc
     JOIN projects p ON p.id = pc.project_id
     LEFT JOIN payment_stages s ON s.id = pc.payment_stage_id
     LEFT JOIN payment_methods pm ON pm.id = pc.payment_method_id
     LEFT JOIN contacts k ON k.id = pc.owed_by_contact_id
  WHERE pc.status = 'pending'::text;

create or replace view public.v_contractor_payouts_due with (security_invoker = true) as
select s.project_id, p.project_name, s.id as payment_stage_id, s.name as milestone,
       ctr.id as contract_id, ctr.contractor_id, coalesce(k.person_name, k.name) as contractor,
       ch.contractor_amount as amount_due, ch.currency, ch.paid_on as collected_on,
       current_date - ch.paid_on as days_since_collected,
       po.status as payout_status, po.provider_reference as payout_reference
  from public.payment_stages s
  join public.projects p on p.id = s.project_id
  left join public.contracts ctr on ctr.id = s.contract_id
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
  'Milestones Green Bergen collected (collected_by = green_bergen) whose contractor share it has not paid out yet - the mirror of v_platform_fees_receivable (migration 242). Clear a row with record_contractor_payout.';

-- ---- due dates -------------------------------------------------------------
create or replace function public.fn_project_bookings_stage_due()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if NEW.accepted_at is not null and OLD.accepted_at is null then
    update public.payment_stages s
       set due_on = NEW.accepted_at::date + m.due_days
      from public.blueprint_package_milestones m
     where m.package_code = NEW.package_code and m.kind = 'payment' and m.due_from = 'accepted'
       and s.project_id = NEW.project_id and s.name = m.name and s.due_on is null;
  end if;
  return NEW;
end $function$;
drop trigger if exists trg_project_bookings_stage_due on public.project_bookings;
create trigger trg_project_bookings_stage_due after update of accepted_at on public.project_bookings
  for each row execute function public.fn_project_bookings_stage_due();

-- ---- the functions that read or write the terms ---------------------------
do $mig$
declare
  src text; n int;
  edits jsonb;
  e jsonb;
begin
  edits := jsonb_build_array(
    -- posting: terms must add up; stages follow them; the note names the payee
    jsonb_build_object('fn', 'public.homeowner_post_internal(uuid)',
      'a', 'if v_reason is not null then return jsonb_build_object(''ok'', false, ''reason'', v_reason); end if;',
      'b', E'if v_reason is not null then return jsonb_build_object(''ok'', false, ''reason'', v_reason); end if;\n  v_reason := public.package_terms_problem(pkg.code, v_price);\n  if v_reason is not null then\n    return jsonb_build_object(''ok'', false, ''reason'', ''This package''''s payment terms do not add up - '' || v_reason || ''. Green Bergen has to fix them before it can be booked.'');\n  end if;'),
    jsonb_build_object('fn', 'public.homeowner_post_internal(uuid)',
      'a', 'insert into public.payment_stages (project_id, name, sequence_no, percent_of_contract, amount, trigger_description, status, requires_photo, created_by_user_id, notes)',
      'b', 'insert into public.payment_stages (project_id, name, sequence_no, percent_of_contract, amount, trigger_description, status, requires_photo, created_by_user_id, notes, due_on)'),
    jsonb_build_object('fn', 'public.homeowner_post_internal(uuid)',
      'a', 'round(v_price * m.percent_of_contract / 10000.0, 2),',
      'b', 'public.package_stage_amount(pkg.code, m.key, v_price),'),
    jsonb_build_object('fn', 'public.homeowner_post_internal(uuid)',
      'a', '''Package milestone ('' || pkg.code || ''.'' || m.key || ''). Paid directly to the contractor; Green Bergen never holds the money.'');',
      'b', E'''Package milestone ('' || pkg.code || ''.'' || m.key || ''). Paid to '' ||\n                case when pkg.collected_by = ''green_bergen'' then ''Green Bergen, which pays the contractor their share.''\n                     else ''the contractor, who owes Green Bergen its mark-up for the lead.'' end,\n              case when m.due_from = ''posted'' then current_date + m.due_days end);'),
    -- the contract says who the homeowner pays
    jsonb_build_object('fn', 'public.homeowner_offer_accept(uuid,uuid)',
      'a', '''Community package accepted at the stated price through the homeowner app. No counter-offer; the price is the package price. Paid directly by the homeowner to the contractor.'')',
      'b', E'''Community package accepted at the stated price through the homeowner app. No counter-offer; the price is the package price. '' ||\n          case when public.stage_collected_by(p_project) = ''green_bergen''\n               then ''The homeowner pays Green Bergen each milestone; Green Bergen keeps its mark-up and pays the contractor this price.''\n               else ''The homeowner pays the contractor each milestone with Green Bergen''''s mark-up on top; the contractor owes Green Bergen the mark-up for the lead.'' end)'),
    -- marking a payment milestone: it falls due; the card message names the payee
    jsonb_build_object('fn', 'public.homeowner_milestone_mark(uuid,text,text,text,uuid)',
      'a', 'update public.payment_stages set status = ''Approved'', approved_by_user_id = me, approved_at = now() where id = s.id;',
      'b', 'update public.payment_stages set status = ''Approved'', approved_by_user_id = me, approved_at = now(), due_on = coalesce(due_on, case when m.due_from = ''milestone'' then current_date + m.due_days end) where id = s.id;'),
    jsonb_build_object('fn', 'public.homeowner_milestone_mark(uuid,text,text,text,uuid)',
      'a', '''reason'', ''Card payments in the app are not switched on yet. The milestone is logged; pay the contractor directly and photograph the check or receipt.'');',
      'b', '''reason'', ''Card payments in the app are not switched on yet. The milestone is logged; pay '' || case when public.stage_collected_by(p_project) = ''green_bergen'' then ''Green Bergen'' else ''the contractor directly'' end || '' and photograph the check or receipt.'');'),
    jsonb_build_object('fn', 'public.homeowner_milestone_mark(uuid,text,text,text,uuid)',
      'a', '''A payment to the contractor is still recorded as unsettled. Record it, then close.''',
      'b', '''A milestone payment is still recorded as unsettled. Record it, then close.'''),
    -- what the app reads
    jsonb_build_object('fn', 'public.homeowner_booking(uuid)',
      'a', '''price_cents'', b.price_cents, ''base_price_cents'', b.base_price_cents,',
      'b', '''collected_by'', public.stage_collected_by(p_project), ''price_cents'', b.price_cents, ''base_price_cents'', b.base_price_cents,'),
    jsonb_build_object('fn', 'public.homeowner_booking(uuid)',
      'a', '''amount_cents'', (coalesce(s.amount,0)*100)::bigint, ''percent'', s.percent_of_contract, ''status'', s.status,',
      'b', '''amount_cents'', (coalesce(s.amount,0)*100)::bigint, ''percent'', s.percent_of_contract, ''due_on'', s.due_on, ''status'', s.status,'),
    jsonb_build_object('fn', 'public.homeowner_progress(uuid)',
      'a', '''stage_status'', s.status,',
      'b', '''due_on'', s.due_on, ''stage_status'', s.status,'),
    jsonb_build_object('fn', 'public.homeowner_package(text)',
      'a', '''percent_of_contract'', m.percent_of_contract, ''typical_range'', m.typical_range,',
      'b', '''percent_of_contract'', m.percent_of_contract, ''amount_cents'', m.amount_cents, ''due_days'', m.due_days, ''due_from'', m.due_from, ''typical_range'', m.typical_range,'),
    jsonb_build_object('fn', 'public.admin_package(text)',
      'a', '''percent_of_contract'', m.percent_of_contract, ''typical_range'', m.typical_range,',
      'b', '''percent_of_contract'', m.percent_of_contract, ''amount_cents'', m.amount_cents, ''due_days'', m.due_days, ''due_from'', m.due_from, ''typical_range'', m.typical_range,'),
    -- Admin > Packages writes the terms
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', 'mk text; mkind text; mname text; seq int; pct numeric; rng text; trig text;',
      'b', 'mk text; mkind text; mname text; seq int; pct numeric; rng text; trig text; m_amt int; m_days int; m_from text;'),
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', 'rng := nullif(btrim(p_patch->>''typical_range''), ''''); trig := nullif(btrim(p_patch->>''trigger_description''), '''');',
      'b', E'rng := nullif(btrim(p_patch->>''typical_range''), ''''); trig := nullif(btrim(p_patch->>''trigger_description''), '''');\n    m_amt := nullif(btrim(coalesce(p_patch->>''amount_cents'', '''')), '''')::int;\n    m_days := nullif(btrim(coalesce(p_patch->>''due_days'', '''')), '''')::int;\n    m_from := nullif(btrim(coalesce(p_patch->>''due_from'', '''')), '''');\n    if pct is not null and m_amt is not null then return jsonb_build_object(''ok'', false, ''reason'', ''A payment is a percent or a fixed amount, not both.''); end if;'),
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', 'insert into public.blueprint_package_milestones (package_code, key, kind, name, sequence_no, percent_of_contract, typical_range, trigger_description)',
      'b', 'insert into public.blueprint_package_milestones (package_code, key, kind, name, sequence_no, percent_of_contract, typical_range, trigger_description, amount_cents, due_days, due_from)'),
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', 'values (v_code, mk, mkind, mname, coalesce(seq, 99), pct, rng, trig) returning id into v_id;',
      'b', 'values (v_code, mk, mkind, mname, coalesce(seq, 99), pct, rng, trig, m_amt, coalesce(m_days, 0), coalesce(m_from, ''milestone'')) returning id into v_id;'),
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', 'percent_of_contract = pct, typical_range = rng, trigger_description = trig',
      'b', 'percent_of_contract = pct, typical_range = rng, trigger_description = trig, amount_cents = m_amt, due_days = coalesce(m_days, 0), due_from = coalesce(m_from, ''milestone'')')
  );
  for e in select * from jsonb_array_elements(edits) loop
    src := pg_get_functiondef((e->>'fn')::regprocedure);
    n := (length(src) - length(replace(src, e->>'a', ''))) / length(e->>'a');
    if n <> 1 then raise exception 'Migration 242: % matched % times in %, expected 1.', e->>'a', n, e->>'fn'; end if;
    execute replace(src, e->>'a', e->>'b');
  end loop;
end $mig$;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
