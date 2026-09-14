-- 093 - From and To replace the direction field.
--
-- Shahar (2026-09-14): "make sure that the UI no longer try to set value on
-- direction." And, when the direction picker was still on the screen: "so do
-- you add to the transaction log the ability to choose direction? or just from
-- & to? where from can be the other side?"
--
-- Just from and to. task_payment_log loses p_direction and gains p_to_account,
-- so the caller states the two ENDS and the database works out which way the
-- money went - instead of the caller asserting a direction that the account
-- fields underneath it could quietly contradict.
--
--   paying someone   -> p_from_account = your account, p_to_account = null
--   money came back  -> p_from_account = null,         p_to_account = your account
--
-- Naming both ends is refused. That case is a transfer between two of your own
-- accounts, which the ledger still cannot express (see fn_transactions_direction)
-- and which no payment screen should be able to smuggle in by accident.
--
-- After this, nothing outside fn_transactions_direction writes the direction
-- column: the trigger derives it from the two account ids on every insert and
-- update, so the column stays correct while nobody types into it. Dropping it
-- is a separate, one-line migration whenever Shahar wants it gone.

-- A parameter list change makes a NEW function; without the drop, PostgREST
-- sees two task_payment_log overloads and refuses the call as ambiguous.
drop function if exists public.task_payment_log(uuid, numeric, uuid, uuid, text, text, date, text, text, text, boolean, uuid[], uuid, text);

create or replace function public.task_payment_log(
  p_action        uuid,
  p_amount        numeric,
  p_method        uuid,
  p_payee_contact uuid    default null,
  p_payee_name    text    default null,
  p_reference     text    default null,
  p_paid_on       date    default null,
  p_from_account  text    default null,
  p_description   text    default null,
  p_notes         text    default null,
  p_awaiting      boolean default false,
  p_file_ids      uuid[]  default null,
  p_id            uuid    default null,
  p_to_account    text    default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me      uuid := public.current_app_user_id();
  a       public.actions;
  pm      public.payment_methods;
  v_id    uuid := coalesce(p_id, gen_random_uuid());
  v_payee uuid := p_payee_contact;
  v_who   text;
  v_name  text := nullif(btrim(p_payee_name), '');
  v_from  text := nullif(btrim(p_from_account), '');
  v_to    text := nullif(btrim(p_to_account), '');
  v_in    boolean;
  f       uuid;
  n       int;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;

  -- The ends ARE the direction. One of them is yours; which one says which way.
  if v_from is not null and v_to is not null then
    return jsonb_build_object('ok', false, 'reason',
      'Name one end, not both. Money moving between two of your own accounts is a transfer, and the ledger cannot hold one yet.');
  end if;
  v_in := v_to is not null;

  select * into a from public.actions where id = p_action;
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'No such task.'); end if;
  if a.project_id is null then
    return jsonb_build_object('ok', false, 'reason', 'That task is not on a project, so a payment has nowhere to hang.');
  end if;
  if not public.fin_may_record(a.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Logging money on this project is not yours to do.');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason',
      case when v_in then 'Enter how much came back - as a positive number. Money coming back is still a positive amount, arriving in your account.'
           else 'Enter what it cost.' end);
  end if;

  select * into pm from public.payment_methods where id = p_method and is_active;
  if pm.id is null then
    return jsonb_build_object('ok', false, 'reason',
      case when v_in then 'Pick how it came back.' else 'Pick how you paid.' end);
  end if;
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

  if v_payee is null then
    if v_name is null then
      return jsonb_build_object('ok', false, 'reason',
        case when v_in then 'Say who it came from - the shop, the supplier, the person.'
             else 'Say who you paid - the shop, the supplier, the person.' end);
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
              'Created when money was logged against a task on ' || to_char(current_date, 'YYYY-MM-DD')
              || '. Nothing is known about them beyond the name.')
      returning id into v_payee;
    end if;
  else
    if not exists (select 1 from public.contacts c where c.id = v_payee) then
      return jsonb_build_object('ok', false, 'reason', 'That person is not on file.');
    end if;
  end if;
  select coalesce(c.person_name, c.name) into v_who from public.contacts c where c.id = v_payee;

  -- No direction column in this list. fn_transactions_direction reads the two
  -- account ids below and sets it.
  insert into public.transactions
    (id, description, amount, paid_on, status, project_id, action_id, contractor_id,
     payment_method_id, payment_reference, paid_from_account, notes, currency, created_by, last_modified_by,
     source_account_id, destination_account_id)
  values
    (v_id,
     coalesce(nullif(btrim(p_description), ''),
              case when v_in then 'Credit — ' || left(a.action, 170) else left(a.action, 180) end),
     p_amount, coalesce(p_paid_on, current_date),
     case when v_in then
            case when coalesce(p_awaiting, false) then 'payment received - pending confirmation'
                 else 'payment received' end
          else
            case when coalesce(p_awaiting, false) then 'paid' else 'paid - receipt filed' end
     end,
     a.project_id, a.id, v_payee,
     pm.id, nullif(btrim(p_reference), ''), coalesce(v_from, v_to),
     nullif(btrim(p_notes), ''), 'USD', 'portal:task-payment', 'portal:task-payment',
     public.money_account_resolve(v_from, a.project_id),
     public.money_account_resolve(v_to,   a.project_id));

  if p_file_ids is not null then
    foreach f in array p_file_ids loop
      if not exists (select 1 from public.files x where x.id = f and x.project_id = a.project_id) then
        return jsonb_build_object('ok', false, 'reason', 'One of those files does not belong to this project.');
      end if;
      delete from public.file_links where file_id = f;
      insert into public.file_links (file_id, transaction_id, role, created_by_user_id)
      values (f, v_id,
              case when (select kind from public.files where id = f) = 'photo' then 'evidence' else 'invoice' end,
              me);
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'transaction_id', v_id, 'paid_to', v_who,
    'payee_contact_id', v_payee, 'amount', p_amount,
    'credit', v_in,
    'awaiting', coalesce(p_awaiting, false));
end $function$;

-- fin_payment_log hardcoded direction 'out' and set no account at all, so
-- every payment logged from the financials screen landed unattributable - the
-- exact hole migration 090 spent 173 rows filling. It records the account now,
-- and says nothing about direction.
do $patch$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fin_payment_log';
  if src is null then raise exception 'PATCH_NO_FUNCTION: fin_payment_log'; end if;

  patched := replace(src,
    $f$(id, description, amount, paid_on, direction, status, project_id, contract_id, contractor_id,$f$,
    $f$(id, description, amount, paid_on, status, project_id, contract_id, contractor_id,$f$);
  patched := replace(patched,
    $f$     budget_category_id, currency, created_by, last_modified_by)$f$,
    $f$     budget_category_id, currency, created_by, last_modified_by, source_account_id)$f$);
  patched := replace(patched,
    $f$     p_amount, coalesce(p_paid_on, current_date), 'out', 'paid', c.project_id, c.id, v_payee,$f$,
    $f$     p_amount, coalesce(p_paid_on, current_date), 'paid', c.project_id, c.id, v_payee,$f$);
  patched := replace(patched,
    $f$'portal:financials', 'portal:financials');$f$,
    $f$'portal:financials', 'portal:financials',
     public.money_account_resolve(p_from_account, c.project_id));$f$);

  if patched = src then
    raise exception 'PATCH_NO_CHANGE: fin_payment_log did not match any expected text';
  end if;
  if patched ~* '\mdirection\M' then
    raise exception 'PATCH_INCOMPLETE: fin_payment_log still mentions direction';
  end if;
  execute patched;
end $patch$;

-- Nothing but the deriving trigger may write the column now.
do $$
declare n int; names text;
begin
  select count(*), string_agg(p.proname, ', ')
    into n, names
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname <> 'fn_transactions_direction'
     and pg_get_functiondef(p.oid) ~ 'into public\.transactions[^;]*\mdirection\M';
  if n > 0 then
    raise exception 'STILL_WRITING_DIRECTION: %', names;
  end if;
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
