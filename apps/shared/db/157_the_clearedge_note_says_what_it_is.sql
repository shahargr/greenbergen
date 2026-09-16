-- 157. THE CLEAREDGE NOTE SAYS WHAT IT IS.
--
-- Shahar (2026-09-16): "Loan info: see attached. please update this into
-- the loan." The attachment is the Closing Disclosure for loan 260438019 -
-- a DRAFT dated 2026-04-29 for the 2026-05-01 closing, six scanned pages.
--
-- What it says: a 30-year conventional purchase loan from ClearEdge Lending
-- LLC of $906,750 at 7.125% fixed, INTEREST ONLY for the first 120 payments
-- ($5,383.83 a month), then $7,098.22 principal and interest from payment
-- 121 to maturity. No prepayment penalty, no balloon, not assumable, 5% late
-- fee after 15 days. Homeowner's insurance is escrowed ($65.17 a month);
-- property taxes are NOT - they are paid to Tenafly directly, which is why
-- the quarterly tax task exists. Prepaid interest ran 5/1 to 6/1, so the
-- first regular payment fell on 2026-07-01 - the date the imported "Finance
-- - interest (mortgage)" task already carried.
--
-- And a correction to 156: loan_terms_line said an interest-only loan's whole
-- principal is due at maturity. On a 10-year IO it is due in instalments
-- from year 11. The line now reads interest_only_until and payment_after
-- from type_details and says so; a loan that IS all-due-at-maturity leaves
-- them out and gets the old sentence. Both lines show cents - a payment is
-- an exact number.

create or replace function public.loan_terms_line(p_contract uuid)
returns text
language sql stable
set search_path to 'public'
as $$
  select case
    when c.id is null then null
    when c.loan_kind is null then
      'LOAN KIND NOT RECORDED - is this interest only? Record the kind, rate, monthly payment and maturity on the contract.'
    else upper(c.loan_kind)
      || coalesce(' · $' || to_char(c.loan_monthly_payment, 'FM999,999,990.00') || ' a month', '')
      || coalesce(' at ' || rtrim(rtrim(c.loan_interest_rate::text, '0'), '.') || '%', '')
      || coalesce(' on $' || to_char(c.loan_principal, 'FM999,999,990'), '')
      || case c.loan_kind
           when 'interest only' then
             case when (c.type_details->>'interest_only_until') is not null then
               ' - the principal does not move until '
               || to_char((c.type_details->>'interest_only_until')::date, 'Mon DD, YYYY')
               || coalesce('; then $' || to_char((c.type_details->>'payment_after')::numeric, 'FM999,999,990.00')
                           || ' principal and interest', ', then principal and interest')
               || coalesce(' to ' || to_char(c.loan_maturity_date, 'Mon DD, YYYY'), '')
               || ' - or all of it at the sale'
             else
               ' - the principal does not move; all of it is due at '
               || coalesce(to_char(c.loan_maturity_date, 'Mon DD, YYYY'), 'maturity or the sale')
             end
           when 'balloon' then ' - a lump sum is due at '
                               || coalesce(to_char(c.loan_maturity_date, 'Mon DD, YYYY'), 'maturity')
           when 'principal and interest' then ' - each payment brings the principal down'
           else '' end
    end
  from (select p_contract as id) x
  left join public.contracts c on c.id = x.id;
$$;

create or replace function public.loan_payment_title(p_contract uuid)
returns text
language sql stable
set search_path to 'public'
as $$
  select 'Monthly loan payment · '
      || coalesce(upper(c.loan_kind), 'KIND NOT RECORDED')
      || coalesce(' · $' || to_char(c.loan_monthly_payment, 'FM999,999,990.00'), '')
      || coalesce(' · ' || coalesce(c.loan_lender, co.company_name, ct.name), '')
  from public.contracts c
  left join public.companies co on co.id = c.counterparty_company_id
  left join public.contacts ct on ct.id = coalesce(c.contractor_id, c.counterparty_contact_id)
  where c.id = p_contract;
$$;

-- The note itself. type_details is set first so the terms trigger, fired by
-- the loan_* columns, renders the interest-only-until sentence in one go.
update public.contracts
   set type_details = coalesce(type_details, '{}'::jsonb) || jsonb_build_object(
         'loan_id', '260438019',
         'product', '10 Year Interest Only, Fixed Rate',
         'loan_type', 'Conventional',
         'purpose', 'Purchase',
         'interest_only_payments', 120,
         'interest_only_until', '2036-05-01',
         'payment_after', 7098.22,
         'escrow_monthly', 65.17,
         'escrow_covers', 'homeowner''s insurance only - property taxes are paid directly',
         'total_monthly_payment', 5449.00,
         'first_payment_date', '2026-07-01',
         'apr', 7.354,
         'prepayment_penalty', false,
         'balloon', false,
         'assumable', false,
         'late_fee', '5% of the principal and interest overdue, after 15 days',
         'broker', 'Go Rascal Inc. - Daniel Meidan (NMLS 267617)',
         'broker_fee', 13147.88,
         'settlement_agent', 'Bridgeview Abstract, Inc.',
         'source', 'Closing Disclosure DRAFT issued 2026-04-29 for the 2026-05-01 closing')
 where id = 'cc22cb9e-de08-4cfd-88f2-ff145df2d291';

update public.contracts
   set loan_kind = 'interest only',
       loan_principal = 906750,
       amount = 906750,
       loan_interest_rate = 7.125,
       loan_term_months = 360,
       loan_monthly_payment = 5383.83,
       loan_maturity_date = '2056-05-01',
       loan_lender = 'ClearEdge Lending LLC',
       start_date = '2026-05-01',
       notes = coalesce(notes || E'\n\n', '')
            || '[2026-09-16] TERMS from the Closing Disclosure (draft of 2026-04-29, closing 2026-05-01, loan 260438019): '
            || '$906,750 at 7.125% fixed, 30 years, conventional purchase. INTEREST ONLY for payments 1-120 at $5,383.83; '
            || 'from payment 121 (2036-05-01) $7,098.22 principal and interest to maturity 2056-05-01. Escrow $65.17/month '
            || 'for homeowner''s insurance only; property taxes (about $15,242/yr) are NOT escrowed and are paid to Tenafly '
            || 'directly. Total monthly $5,449.00. No prepayment penalty, no balloon, not assumable; late fee 5% after 15 days. '
            || 'Prepaid interest 5/1-6/1/2026, first regular payment 2026-07-01. Broker Go Rascal Inc. (Daniel Meidan), '
            || 'broker fee $13,147.88. The disclosure was a DRAFT - confirm against the signed note if anything differs.',
       last_modified_by = 'Claude (157)'
 where id = 'cc22cb9e-de08-4cfd-88f2-ff145df2d291';

-- Step 20 of the loan process, "Record the loan terms on the contract", is
-- what this migration did.
do $$
declare v_step uuid;
begin
  select a.id into v_step
    from public.actions a
    join public.actions p on p.id = a.parent_action_id
   where p.contract_id = 'cc22cb9e-de08-4cfd-88f2-ff145df2d291'
     and p.activity_blueprint_id = (select id from public.blueprint_activity where name = 'Mortgage or construction loan')
     and a.step_order = 20 and a.status not in ('Completed','Cancelled','Force Cancelled');
  if v_step is not null then
    insert into public.action_comments (action_id, body, author)
    values (v_step, 'Recorded from the Closing Disclosure (draft, 2026-04-29): ' || public.loan_terms_line('cc22cb9e-de08-4cfd-88f2-ff145df2d291'), 'Claude (157)');
    perform public.close_action(v_step, false, 'Claude (157)');
  end if;
end $$;

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
