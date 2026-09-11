-- 058 - log a payment against a contract, no milestone needed.
--
-- Shahar (2026-09-11): "shahar needs in his GC interface for 55 Walnut to
-- start close tasks and log payments." Eleven live contracts on 55 Walnut
-- have no payment schedule - framing, masonry, lumber were paid as plain
-- payments against the contract, the way the portal's old payment form
-- wrote them. The money page (057) only recorded against milestones, so a
-- check already written had no way in without inventing a schedule first.
--
-- fin_payment_log writes what that form wrote: one transactions row,
-- anchored on the contract and the project (rulebook 50), with method,
-- reference, date, the account it left, and the check photo. Rulebook 51
-- in full: no logged payment without a reference where the rail needs one;
-- the image rides along. fn_transactions_notify_task then opens the
-- "awaiting confirmation" task and parks the row at paid - pending
-- confirmation, exactly as before.
--
-- The evidence: file_links has no transaction column, and the portal's
-- convention is the PATH - <project>/payments/<transaction>/... - which is
-- what project_financials and portal_transaction_detail already read. So
-- the caller mints the transaction id first (p_id), uploads under it, and
-- passes both; the files are also linked to the contract (role invoice for
-- a document, evidence for a photo) so a contract-bounded payee can see
-- the proof of what they were paid.
create or replace function public.fin_payment_log(
  p_contract uuid, p_amount numeric, p_method uuid,
  p_reference text default null, p_paid_on date default null, p_from_account text default null,
  p_notes text default null, p_invoice_reference text default null, p_description text default null,
  p_file_ids uuid[] default null, p_id uuid default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id(); c public.contracts; pm public.payment_methods;
  v_id uuid := coalesce(p_id, gen_random_uuid()); v_payee uuid; v_who text; f uuid; r jsonb;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into c from public.contracts where id = p_contract;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'No such contract.'); end if;
  if not public.fin_may_record(c.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Only the owner side logs a payment.');
  end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'reason', 'Enter the amount paid.'); end if;
  select * into pm from public.payment_methods where id = p_method and is_active;
  if pm.id is null then return jsonb_build_object('ok', false, 'reason', 'Pick how it was paid.'); end if;
  if pm.settlement_type = 'processor' then
    return jsonb_build_object('ok', false, 'reason', format('%s is collected in the app, not logged by hand.', pm.name));
  end if;
  if coalesce(pm.requires_reference, false) and nullif(btrim(p_reference), '') is null then
    return jsonb_build_object('ok', false, 'reason', format('%s needs a reference (%s). A payment without one cannot be reconciled later.', pm.name, coalesce(pm.notes, 'confirmation number')));
  end if;
  if exists (select 1 from public.transactions t where t.id = v_id) then
    return jsonb_build_object('ok', false, 'reason', 'This payment was already logged.');
  end if;

  -- Who got paid: the contractor the contract names, else its counterparty.
  v_payee := coalesce(c.contractor_id, c.counterparty_contact_id);
  select coalesce(k.person_name, k.name) into v_who from public.contacts k where k.id = v_payee;
  if v_who is null then select co.company_name into v_who from public.companies co where co.id = c.counterparty_company_id; end if;

  insert into public.transactions
    (id, description, amount, paid_on, direction, status, project_id, contract_id, contractor_id,
     payment_method_id, payment_reference, invoice_reference, paid_from_account, notes,
     budget_category_id, currency, created_by, last_modified_by)
  values
    (v_id,
     coalesce(nullif(btrim(p_description), ''), 'Payment to ' || coalesce(v_who, 'contractor') || ' - ' || c.title),
     p_amount, coalesce(p_paid_on, current_date), 'out', 'paid', c.project_id, c.id, v_payee,
     pm.id, nullif(btrim(p_reference), ''), nullif(btrim(p_invoice_reference), ''), nullif(btrim(p_from_account), ''),
     nullif(btrim(p_notes), ''), c.budget_category_id, coalesce(c.currency, 'USD'), 'portal:financials', 'portal:financials');

  if p_file_ids is not null then
    foreach f in array p_file_ids loop
      r := public.fin_evidence_attach(f, null, c.id, null);
      if not (r->>'ok')::boolean then return r; end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'transaction_id', v_id, 'paid_to', v_who);
end $$;
revoke all on function public.fin_payment_log(uuid, numeric, uuid, text, date, text, text, text, text, uuid[], uuid) from public, anon;
grant execute on function public.fin_payment_log(uuid, numeric, uuid, text, date, text, text, text, text, uuid[], uuid) to authenticated, service_role;

update public.help
   set content = content || E'\n\n' ||
     'LOG A PAYMENT WITHOUT A MILESTONE (migration 058, Shahar 2026-09-11). Most 55 Walnut contracts have no schedule; a check already written must still land. fin_payment_log(contract, amount, method, reference, paid_on, from_account, notes, invoice_reference, description, file_ids, id) writes one transactions row anchored on the contract and its project - status paid, so fn_transactions_notify_task opens the confirmation task as always - and refuses a manual rail without its reference. The screen mints the transaction id first and uploads the evidence under <project>/payments/<id>/ (the portal''s convention, which the ledger reads back), and the files are also linked to the contract so a bounded payee sees the proof. "Log a payment" sits on every contract card for the owner side; a milestone is still the way to record when there is one.',
       updated_at = now()
 where topic = 'money' and title like 'Project financials page%';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
