-- 086  MONEY CAN COME BACK
--
-- Shahar (2026-09-13), on the task "Follow up with George Orellana (Kuiken)
-- on the lumber credit for the treated wood returned today": "tried to log in
-- negative value as credit -1646.14 and got this error" - Enter what it cost.
--
-- The refusal is right and the model behind it was incomplete. A credit is
-- not a negative payment; it is money coming IN. transactions already knows
-- the difference - it has a direction column, transaction_statuses carries a
-- direction per status, and every roll-up in the database filters on it. All
-- 173 rows today hold a POSITIVE amount and let direction carry the sign; the
-- one existing 'in' row is $559.
--
-- Storing -1646.14 as an 'out' would have been the first negative in the
-- table and would have quietly poisoned everything that sums by direction
-- rather than by sign: portal_finance_rollup, portal_my_work, portal_site_week,
-- project_financials, app_contractor_rollup, portal_contractor,
-- portal_bidder_history, portal_project_close. Eight roll-ups, all correct
-- today, all wrong the moment a sign appears where a direction belongs.
--
-- So: task_payment_log learns the direction, and the amount stays positive
-- either way. And the one place that was summing without asking - the
-- per-task money added last night in migration 078 - learns to NET, because a
-- credit that increases "spent on this task" is worse than no credit at all.
--
-- A NOTE ON refunded. That status exists and means the whole payment went out
-- and came back. This is a partial credit against a purchase that stands, so
-- it is its own row: the original payment is still true and the credit is a
-- second fact about the same task.

-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than replaced: adding a parameter makes a NEW
-- signature, and two overloads of task_payment_log would leave PostgREST
-- picking one by argument names (migration 071 hit the same thing).
drop function if exists public.task_payment_log(
  uuid, numeric, uuid, uuid, text, text, date, text, text, text, boolean, uuid[], uuid);

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
  p_id             uuid    default null,
  -- 'out' is money you paid; 'in' is money that came back - a credit, a
  -- rebate, a partial refund. The amount is POSITIVE either way.
  p_direction      text    default 'out'
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  me      uuid := public.current_app_user_id();
  a       public.actions;
  pm      public.payment_methods;
  v_id    uuid := coalesce(p_id, gen_random_uuid());
  v_payee uuid := p_payee_contact;
  v_who   text;
  v_name  text := nullif(btrim(p_payee_name), '');
  v_dir   text := lower(coalesce(nullif(btrim(p_direction), ''), 'out'));
  v_in    boolean;
  f       uuid;
  n       int;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if v_dir not in ('in', 'out') then
    return jsonb_build_object('ok', false, 'reason', 'Money either went out or came in.');
  end if;
  v_in := v_dir = 'in';

  select * into a from public.actions where id = p_action;
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'No such task.'); end if;
  if a.project_id is null then
    return jsonb_build_object('ok', false, 'reason', 'That task is not on a project, so a payment has nowhere to hang.');
  end if;
  if not public.fin_may_record(a.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Logging money on this project is not yours to do.');
  end if;
  -- POSITIVE EITHER WAY. A credit is not a negative payment - it is a
  -- positive amount travelling the other way, and the sign lives in
  -- direction, where all eight roll-ups already look for it.
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason',
      case when v_in then 'Enter how much came back - as a positive number. Money coming in is the direction, not a minus sign.'
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

  -- THE COUNTERPARTY. Who you paid, or who the credit came from - the same
  -- contact either way, which is the point: Kuiken is one supplier whether
  -- the money is going or coming.
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

  insert into public.transactions
    (id, description, amount, paid_on, direction, status, project_id, action_id, contractor_id,
     payment_method_id, payment_reference, paid_from_account, notes, currency, created_by, last_modified_by)
  values
    (v_id,
     coalesce(nullif(btrim(p_description), ''),
              case when v_in then 'Credit — ' || left(a.action, 170) else left(a.action, 180) end),
     p_amount, coalesce(p_paid_on, current_date), v_dir,
     -- The statuses that mean the money moved, one per direction. Awaiting
     -- means the other side has not confirmed it yet.
     case when v_in then
            case when coalesce(p_awaiting, false) then 'payment received - pending confirmation'
                 else 'payment received' end
          else
            case when coalesce(p_awaiting, false) then 'paid' else 'paid - receipt filed' end
     end,
     a.project_id, a.id, v_payee,
     pm.id, nullif(btrim(p_reference), ''), nullif(btrim(p_from_account), ''),
     nullif(btrim(p_notes), ''), 'USD', 'portal:task-payment', 'portal:task-payment');

  -- The receipt, the credit note, the photo of the thing - filed against the
  -- PAYMENT (migration 084), one target, which is what file_links requires.
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
    'direction', v_dir, 'credit', v_in,
    'awaiting', coalesce(p_awaiting, false));
end $function$;

revoke all on function public.task_payment_log(
  uuid, numeric, uuid, uuid, text, text, date, text, text, text, boolean, uuid[], uuid, text)
  from public, anon;
grant execute on function public.task_payment_log(
  uuid, numeric, uuid, uuid, text, text, date, text, text, text, boolean, uuid[], uuid, text)
  to authenticated;

comment on function public.task_payment_log(
  uuid, numeric, uuid, uuid, text, text, date, text, text, text, boolean, uuid[], uuid, text) is
  'Log money against a task. p_direction ''out'' is a payment, ''in'' is a credit or refund; the amount is positive either way and the sign lives in direction.';

-- ---------------------------------------------------------------------------
-- THE PER-TASK MONEY NETS. Added in 078, and it summed every row whose status
-- meant the money had moved without asking WHICH WAY - so a credit would have
-- pushed "spent on this task" UP. Net cost is out minus in, and the credit is
-- reported beside it so a row can say both.
create or replace function public.portal_task_money(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with fam as (
    select project_id from public.fin_family(p_project)
  ),
  tx as (
    select t.action_id,
           coalesce(t.amount_usd, t.amount, 0) as amt,
           coalesce(ts.means_money_moved, false) as moved,
           coalesce(ts.is_terminal, false) as ended,
           coalesce(t.direction, 'out') as dir
      from public.transactions t
      join fam on fam.project_id = t.project_id
      left join public.transaction_statuses ts on ts.status = t.status
     where t.action_id is not null
       and public.can_see_money_on(t.project_id, t.contract_id)
  ),
  per as (
    select action_id,
           -- NET cost: what went out, less what came back.
           coalesce(sum(amt) filter (where moved and dir = 'out'), 0)
             - coalesce(sum(amt) filter (where moved and dir = 'in'), 0) as spent,
           coalesce(sum(amt) filter (where moved and dir = 'in'), 0) as credited,
           coalesce(sum(amt) filter (where not moved and not ended and dir <> 'in'), 0) as owed,
           count(*) as n
      from tx
     group by action_id
  )
  select jsonb_build_object(
    'tasks', coalesce((
      select jsonb_object_agg(action_id::text, jsonb_build_object(
        'spent', round(spent), 'credited', round(credited), 'owed', round(owed), 'n', n))
        from per), '{}'::jsonb),
    'spent', (select round(coalesce(sum(spent), 0)) from per),
    'credited', (select round(coalesce(sum(credited), 0)) from per),
    'owed',  (select round(coalesce(sum(owed), 0)) from per),
    'can_log', public.fin_may_record(p_project)
  );
$function$;

-- ---------------------------------------------------------------------------
-- A PAYMENT ROW SAYS WHICH WAY IT WENT, so the screen can draw a credit as a
-- credit instead of as one more cost.
do $patch$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_detail';
  if src is null then raise exception 'portal_task_detail not found'; end if;
  if position('''direction'', t.direction' in src) > 0 then
    raise notice 'payments already say their direction'; return;
  end if;
  patched := replace(src, '''contract_id'', t.contract_id,',
                          '''contract_id'', t.contract_id, ''direction'', t.direction,');
  if patched = src then raise exception 'portal_task_detail payment block not found - patch by hand'; end if;
  execute patched;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();

-- ---------------------------------------------------------------------------
-- 086c  EDITING A CREDIT OFFERS CREDIT STATUSES.
--
-- portal_transaction_edit's hand-settable list was the outgoing one: paid,
-- paid - pending confirmation, paid - receipt filed, refunded, disputed,
-- cancelled. Setting a credit to "payment received" would have been refused
-- as "not a state you can set by hand". The list is now direction-aware, and
-- a second check reads transaction_statuses.direction so a status can never
-- contradict the way its own row's money travelled - the kind of thing eight
-- roll-ups read and none would notice.
do $patch$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_transaction_edit';
  if src is null then raise exception 'portal_transaction_edit not found'; end if;
  if position('payment received' in src) > 0 then
    raise notice 'already direction-aware'; return;
  end if;
  patched := replace(src,
    $old$    if v_status is not null and v_status not in
       ('paid', 'paid - pending confirmation', 'paid - receipt filed', 'refunded', 'disputed', 'cancelled') then
      return jsonb_build_object('ok', false, 'reason', 'That is not a state you can set by hand.');
    end if;$old$,
    $new$    if v_status is not null and v_status not in
       (case when coalesce(t.direction, 'out') = 'in' then v_status else '' end,
        'refunded', 'disputed', 'cancelled',
        'paid', 'paid - pending confirmation', 'paid - receipt filed') then
      return jsonb_build_object('ok', false, 'reason', 'That is not a state you can set by hand.');
    end if;
    if v_status is not null and exists (
      select 1 from public.transaction_statuses ts
       where ts.status = v_status
         and ts.direction <> 'both'
         and ts.direction <> coalesce(t.direction, 'out')) then
      return jsonb_build_object('ok', false, 'reason',
        format('%s is a state for money going the other way. This row is money %s.',
               initcap(v_status), case when coalesce(t.direction,'out') = 'in' then 'coming in' else 'going out' end));
    end if;$new$);
  if patched = src then raise exception 'status block not found - patch by hand'; end if;
  execute patched;
end $patch$;

-- ---------------------------------------------------------------------------
-- 086d  A CREDIT IN HAND AWAITS NOBODY. Found by probing 086a: the first
-- credit came back as 'payment received - pending confirmation' with a
-- High-priority chase task attached, even though nothing had been marked
-- awaiting.
--
-- fn_transactions_notify_task opens that task and moves the row to a pending
-- status. Migration 065 gave it one exemption - "a purchase made and
-- receipted in one go is not awaiting anyone's confirmation" - but wrote the
-- test as a single literal, 'paid - receipt filed', which is the OUTGOING
-- terminal status. The incoming equivalent, 'payment received', is equally
-- final and equally awaiting nobody.
--
-- The exemption now asks the vocabulary what it always meant: is this status
-- TERMINAL and does it mean the money MOVED. Outgoing behaviour is unchanged
-- to the letter; credits stop growing chase tasks nobody asked for.
do $patch$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_transactions_notify_task';
  if src is null then raise exception 'fn_transactions_notify_task not found'; end if;
  if position('ts2.is_terminal' in src) > 0 then
    raise notice 'exemption already reads the vocabulary'; return;
  end if;
  patched := replace(src,
    $old$  if TG_OP = 'INSERT' and NEW.status = 'paid - receipt filed' then
    return NEW;
  end if;$old$,
    $new$  if TG_OP = 'INSERT' and exists (
       select 1 from public.transaction_statuses ts2
        where ts2.status = NEW.status
          and ts2.direction in (NEW.direction, 'both')
          and ts2.is_terminal and ts2.means_money_moved) then
    return NEW;
  end if;$new$);
  if patched = src then raise exception 'exemption block not found - patch by hand'; end if;
  execute patched;
end $patch$;

-- Verified together in one rolled-back probe on his lumber task:
--   credit, in hand   -> payment received                        (no chase task)
--   credit, awaiting  -> payment received - pending confirmation (1 chase task)
--   payment, in hand  -> paid - receipt filed                    (unchanged)
--   net on the task   -> spent -1496, credited 1696
-- and a negative amount is still refused, now saying why.
