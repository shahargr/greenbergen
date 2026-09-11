-- 065 - a task can carry what it cost.
--
-- Shahar (2026-09-11), on the Professionals task screen: "add: log payment
-- against a task, for example, just purchased this sign online so i can add
-- a payment directly from here."
--
-- Money already knew how to hang off a task: transactions.action_id has
-- always been there. What was missing is a write path. fin_payment_log
-- (058) needs a CONTRACT, and a sign bought online has none - there is no
-- contractor, no milestone, nothing to settle. That payment is an OTHER
-- COST: a transaction on the project with contract_id null, which is
-- exactly what project_financials already gathers under 'other_costs'.
--
-- Three parts.
--
-- 1. task_payment_log - the write path, one function, same shape and same
--    refusals as the rest of the money surface (rulebook 50-53): a live
--    payment method that is not a processor rail, a reference where the
--    rail needs one, an amount, and a payee.
--
--    THE PAYEE IS REQUIRED, and not out of ceremony: the transactions table
--    refuses a priced row that has neither a contract nor a contractor
--    (chk_transactions_payment_complete). Somebody was paid. So the
--    function takes either a contact you already have or a NAME, and a name
--    that matches nothing on file becomes a contact - a shop you bought
--    from is a counterparty like any other, and the next purchase finds it.
--
-- 2. A purchase you made yourself is not awaiting anyone's confirmation.
--    fn_transactions_notify_task opens an "Awaiting confirmation from X"
--    task for every payment, which is right when you paid a contractor and
--    noise when you bought a sign and have the receipt in your inbox. The
--    trigger now skips a row INSERTED already at 'paid - receipt filed' -
--    the terminal, receipt-in-hand status. Nothing today inserts that
--    status (record_manual_payment inserts 'paid'; fin_receipt_confirm
--    UPDATES to receipt-filed and is unaffected), so no existing flow moves.
--
-- 3. portal_task_detail carries the task's payments, and says whether the
--    person looking may log one - money visibility on a task follows the
--    same ladder as everywhere else (can_view_project_financials), so a
--    crew member reading the task sees the work and not the cost.

-- ---------------------------------------------------------------------------
create or replace function public.task_payment_log(
  p_action         uuid,
  p_amount         numeric,
  p_method         uuid,
  p_payee_contact  uuid    default null,
  p_payee_name     text    default null,
  p_reference      text    default null,
  p_paid_on        date    default null,
  p_from_account   text    default null,
  p_description    text    default null,
  p_notes          text    default null,
  p_awaiting       boolean default false,
  p_file_ids       uuid[]  default null,
  p_id             uuid    default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me      uuid := public.current_app_user_id();
  a       public.actions;
  pm      public.payment_methods;
  v_id    uuid := coalesce(p_id, gen_random_uuid());
  v_payee uuid := p_payee_contact;
  v_who   text;
  v_name  text := nullif(btrim(p_payee_name), '');
  f       uuid;
  n       int;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;

  select * into a from public.actions where id = p_action;
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'No such task.'); end if;
  if a.project_id is null then
    return jsonb_build_object('ok', false, 'reason', 'That task is not on a project, so a payment has nowhere to hang.');
  end if;
  if not public.fin_may_record(a.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Logging money on this project is not yours to do.');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'Enter what it cost.');
  end if;

  select * into pm from public.payment_methods where id = p_method and is_active;
  if pm.id is null then return jsonb_build_object('ok', false, 'reason', 'Pick how you paid.'); end if;
  if pm.settlement_type = 'processor' then
    return jsonb_build_object('ok', false, 'reason', format('%s is collected in the app, not logged by hand.', pm.name));
  end if;
  if coalesce(pm.requires_reference, false) and nullif(btrim(p_reference), '') is null then
    return jsonb_build_object('ok', false, 'reason',
      format('%s needs a reference (%s). A payment without one cannot be reconciled later.',
             pm.name, coalesce(pm.notes, 'confirmation number')));
  end if;
  if exists (select 1 from public.transactions t where t.id = v_id) then
    return jsonb_build_object('ok', false, 'reason', 'This payment was already logged.');
  end if;

  -- WHO WAS PAID. A contact you picked, else a name: one match on file is
  -- that contact, no match becomes one, and several matches is a question
  -- for a person rather than a guess by a function.
  if v_payee is null then
    if v_name is null then
      return jsonb_build_object('ok', false, 'reason', 'Say who you paid - the shop, the supplier, the person.');
    end if;
    select count(*) into n from public.contacts c
     where c.disabled_at is null and lower(coalesce(c.person_name, c.name)) = lower(v_name);
    if n > 1 then
      return jsonb_build_object('ok', false, 'reason',
        format('There is more than one "%s" on file. Pick the right one from the list.', v_name));
    end if;
    select c.id into v_payee from public.contacts c
     where c.disabled_at is null and lower(coalesce(c.person_name, c.name)) = lower(v_name) limit 1;
    if v_payee is null then
      insert into public.contacts (name, person_name, source, created_by, notes)
      values (v_name, v_name, 'task payment', 'portal:task-payment',
              'Created when a payment was logged against a task on ' || to_char(current_date, 'YYYY-MM-DD')
              || '. Nothing is known about them beyond the name and that they were paid.')
      returning id into v_payee;
    end if;
  else
    if not exists (select 1 from public.contacts c where c.id = v_payee) then
      return jsonb_build_object('ok', false, 'reason', 'That person is not on file.');
    end if;
  end if;
  select coalesce(c.person_name, c.name) into v_who from public.contacts c where c.id = v_payee;

  insert into public.transactions
    (id, description, amount, paid_on, direction, status, project_id, action_id, contractor_id,
     payment_method_id, payment_reference, paid_from_account, notes, currency, created_by, last_modified_by)
  values
    (v_id,
     coalesce(nullif(btrim(p_description), ''), left(a.action, 180)),
     p_amount, coalesce(p_paid_on, current_date), 'out',
     -- Receipt in hand unless you are waiting on them to confirm it landed.
     case when coalesce(p_awaiting, false) then 'paid' else 'paid - receipt filed' end,
     a.project_id, a.id, v_payee,
     pm.id, nullif(btrim(p_reference), ''), nullif(btrim(p_from_account), ''),
     nullif(btrim(p_notes), ''), 'USD', 'portal:task-payment', 'portal:task-payment');

  -- The receipt, the photo of the thing, the order confirmation - filed
  -- against the task, where the next person looking for it will look.
  if p_file_ids is not null then
    foreach f in array p_file_ids loop
      -- A file from another project is not evidence of anything here, and
      -- this function runs as definer: check before touching its links.
      if not exists (select 1 from public.files x where x.id = f and x.project_id = a.project_id) then
        return jsonb_build_object('ok', false, 'reason', 'One of those files does not belong to this project.');
      end if;
      delete from public.file_links where file_id = f;
      insert into public.file_links (file_id, action_id, project_id, role, created_by_user_id)
      values (f, a.id, a.project_id,
              case when (select kind from public.files where id = f) = 'photo' then 'evidence' else 'invoice' end,
              me);
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'transaction_id', v_id, 'paid_to', v_who,
    'payee_contact_id', v_payee, 'amount', p_amount,
    'awaiting', coalesce(p_awaiting, false));
end $$;
revoke all on function public.task_payment_log(uuid, numeric, uuid, uuid, text, text, date, text, text, text, boolean, uuid[], uuid) from public, anon;
grant execute on function public.task_payment_log(uuid, numeric, uuid, uuid, text, text, date, text, text, text, boolean, uuid[], uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A payment that arrives with its receipt already filed is not waiting on
-- anyone. Everything else about the notice is unchanged.
CREATE OR REPLACE FUNCTION public.fn_transactions_notify_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project public.projects;
  v_party   text; v_asset text; v_title text; v_verb text;
  v_amount  text; v_method text; v_key text;
  v_moved   boolean; v_when date;
begin
  select means_money_moved into v_moved
    from public.transaction_statuses
   where status = NEW.status and direction in (NEW.direction, 'both') limit 1;

  if not coalesce(v_moved, false) or NEW.amount is null then
    return NEW;
  end if;

  -- A purchase you made yourself, logged with the receipt in hand (migration
  -- 065): nobody owes you a confirmation, so no task is opened. Only an
  -- INSERT at the terminal status counts - fin_receipt_confirm UPDATES a
  -- pending row to this status, and that path is unchanged.
  if TG_OP = 'INSERT' and NEW.status = 'paid - receipt filed' then
    return NEW;
  end if;

  v_when := coalesce(NEW.paid_on, current_date);
  select * into v_project from public.projects where id = NEW.project_id;

  select coalesce(c.person_name, c.name) into v_party
    from public.contacts c where c.id = NEW.contractor_id;
  if v_party is null and NEW.contract_id is not null then
    select coalesce(co.company_name, ct.title) into v_party
      from public.contracts ct
      left join public.companies co on co.id = ct.counterparty_company_id
     where ct.id = NEW.contract_id;
  end if;
  v_party := coalesce(v_party, 'counterparty not recorded');

  select a.asset_name into v_asset from public.assets a where a.id = NEW.asset_id;

  v_key    := coalesce(v_project.project_name, v_asset, NEW.contract_id::text, 'unassigned');
  v_amount := to_char(coalesce(NEW.amount_usd, NEW.amount), 'FM999,999,999.00');
  v_method := coalesce(NEW.paid_via,
                       (select name from public.payment_methods where id = NEW.payment_method_id),
                       'not recorded');

  if NEW.direction = 'in' then
    v_verb  := 'received from';
    v_title := 'Awaiting confirmation from ' || v_party || ' - $' || v_amount || ' received ' || to_char(v_when, 'Mon FMDD');
  else
    v_verb  := 'paid to';
    v_title := 'Awaiting confirmation from ' || v_party || ' - $' || v_amount || ' paid ' || to_char(v_when, 'Mon FMDD');
  end if;

  insert into public.actions (
    action, status, pending_reason, priority, domain, project_id, contract_id, asset_id,
    target_date, source, created_by, desired_outcome, notes
  ) values (
    v_title,
    'Pending on Others',
    v_party || ' has not yet confirmed receipt of $' || v_amount || ' sent ' ||
      to_char(v_when, 'YYYY-MM-DD') || '.',
    'High', coalesce(v_project.domain, 'construction'),
    NEW.project_id, NEW.contract_id, NEW.asset_id, v_when,
    'system:transaction:' || NEW.id::text, 'system:payment-notice',
    v_party || ' confirms the payment landed. Closing this moves the transaction to "paid - receipt filed".',
    'PAYMENT MADE - AWAITING CONFIRMATION.' || E'\n' ||
    'Key: '       || v_key || E'\n' ||
    'Date: '      || to_char(v_when, 'YYYY-MM-DD') || E'\n' ||
    'Direction: ' || NEW.direction || ' (' || v_verb || ' ' || v_party || ')' || E'\n' ||
    'Amount: '    || coalesce(NEW.currency, 'USD') || ' ' || v_amount || E'\n' ||
    'Method: '    || v_method || E'\n' ||
    coalesce('Invoice ref: ' || NEW.invoice_reference || E'\n', '') ||
    coalesce('Payment ref: ' || NEW.payment_reference || E'\n', '') ||
    coalesce('Comments: '    || NEW.notes || E'\n', '') ||
    coalesce('Description: ' || NEW.description, '')
  )
  on conflict (source) where source like 'system:transaction:%' do nothing;

  if pg_trigger_depth() <= 1 then
    if NEW.direction = 'out' and NEW.status = 'paid' then
      update public.transactions set status = 'paid - pending confirmation' where id = NEW.id;
    elsif NEW.direction = 'in' and NEW.status = 'payment received' then
      update public.transactions set status = 'payment received - pending confirmation' where id = NEW.id;
    end if;
  end if;

  return NEW;
exception when others then
  insert into public.system_trigger_errors (trigger_fn, row_id, sqlstate, message)
  values ('fn_transactions_notify_task', NEW.id, sqlstate, sqlerrm);
  return NEW;
end $function$;

-- ---------------------------------------------------------------------------
-- The task screen reads one function, so what a task cost belongs in it.
CREATE OR REPLACE FUNCTION public.portal_task_detail(p_task uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when a.id is null or not public.is_project_member(a.project_id) then null
    else jsonb_build_object(
      'id', a.id, 'action', a.action, 'status', a.status, 'priority', a.priority,
      'target_date', a.target_date, 'desired_outcome', a.desired_outcome, 'notes', a.notes,
      'pending_on', a.pending_on, 'pending_reason', a.pending_reason, 'pending_category', a.pending_category,
      'requires_photo_evidence', a.requires_photo_evidence,
      'created_at', a.created_at, 'created_by', a.created_by, 'last_updated', a.last_updated,
      'project_id', a.project_id,
      'project', (select p.project_name from projects p where p.id = a.project_id),
      'can_edit', public.can_edit_project(a.project_id),
      -- Money on a task follows the money ladder, not the task ladder: a
      -- crew member reads the work and never the cost (migration 065).
      'can_log_payment', public.fin_may_record(a.project_id),
      'payments', case when public.can_view_project_financials(a.project_id) then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'description', t.description, 'amount', t.amount, 'paid_on', t.paid_on,
                 'status', t.status, 'reference', t.payment_reference, 'from_account', t.paid_from_account,
                 'method', (select m.name from payment_methods m where m.id = t.payment_method_id),
                 'paid_to', (select coalesce(c.person_name, c.name) from contacts c where c.id = t.contractor_id),
                 'contract_id', t.contract_id)
               order by t.paid_on desc nulls last, t.created_at desc)
        from transactions t where t.action_id = a.id), '[]'::jsonb) else '[]'::jsonb end,
      'assignee', (select jsonb_build_object('id', c.id, 'name', coalesce(c.person_name, c.name))
                   from contacts c where c.id = a.assigned_to_contact_id),
      'evidence', coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'kind', f.kind,
                                            'bucket', f.bucket, 'path', f.path, 'role', fl.role)
                         order by f.created_at desc)
        from file_links fl join files f on f.id = fl.file_id
        where fl.action_id = a.id), '[]'::jsonb),
      'comments', coalesce((
        select jsonb_agg(jsonb_build_object('author', c.author, 'body', left(c.body, 300),
                                            'created_at', c.created_at)
                         order by c.created_at desc)
        from (select ac.author, ac.body, ac.created_at
                from action_comments ac where ac.action_id = a.id
               order by ac.created_at desc limit 8) c), '[]'::jsonb),
      'open_children', (select count(*) from actions ch where ch.parent_action_id = a.id
                        and ch.status not in ('Completed','Cancelled','Force Cancelled','Superseded')),
      -- How it was paid, for the form that logs the next one.
      'methods', case when public.fin_may_record(a.project_id) then coalesce((
        select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'requires_reference', m.requires_reference)
                 order by m.display_order nulls last, m.name)
        from payment_methods m where m.is_active and m.settlement_type = 'manual'), '[]'::jsonb) else '[]'::jsonb end
    ) end
  from actions a where a.id = p_task;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
