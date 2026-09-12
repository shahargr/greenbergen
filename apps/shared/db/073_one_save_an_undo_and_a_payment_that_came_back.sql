-- 073 - undo the line you just wrote, and correct the money you just logged.
--
-- Shahar (2026-09-12), three things about the task screen:
--
--   "if i update multiple fields, and add a photo, and only save at the end,
--    I am losing pretty much all the fields I updated."
--   "after clicking save, you should stay on this very same line added, as
--    sometime you would want to edit. would be good to set an option for undo
--    as well."
--   "inside a task, i cannot edit the transaction. it is status paid, however,
--    it was refunded. where can we edit the transactions from?"
--
-- The first two are the app's fault and are fixed there: the task screen had
-- THREE forms with three save buttons, and pressing the last one submitted
-- only its own third of the screen and then navigated away. It is one form
-- with one save now, and it stays put. This migration carries the two things
-- the app cannot do on its own.
--
-- 1. portal_task_note_delete - the undo. The entry you just posted, taken off
--    the task. Its files STAY on the project: they were really uploaded, and
--    the photograph of the work is worth keeping even when the sentence was
--    wrong. Yours to remove, or the site runner's.
--
-- 2. Editing a transaction, from anywhere. The honest answer to "where can we
--    edit the transactions from" was NOWHERE - nothing in any app could
--    change a transaction after it was written, which is why a refund had no
--    home. portal_transaction_edit fixes that, and a new status says what
--    happened to the money rather than pretending it never left:
--
--      refunded - it was paid, and it came back.
--
--    It counts as neither paid nor committed, because both rollups filter on
--    explicit lists that do not name it, so a refunded purchase falls out of
--    the cost of the job on its own. The ONE list that needed the word is
--    portal_my_work's "owed", which excludes the settled statuses - without
--    it a refunded payment would come back as money still owed.

insert into public.transaction_statuses (status, direction, sort_order, is_terminal, means_money_moved, description, created_by)
values ('refunded', 'both', 95, true, false,
        'Paid, and then returned in full. The money left the account and came back, so it is neither a cost nor an obligation - but the record of it happening stays.',
        'claude')
on conflict (status) do nothing;

-- ---------------------------------------------------------------------------
-- UNDO THE LINE YOU JUST ADDED.
create or replace function public.portal_task_note_delete(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id();
  c  public.action_comments;
  a  public.actions;
  v_contact uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;

  select * into c from public.action_comments where id = p_id;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'That entry is not here - it may already be gone.'); end if;
  select * into a from public.actions where id = c.action_id;
  if a.id is null or not public.can_see_action(c.action_id) then
    return jsonb_build_object('ok', false, 'reason', 'That task is not yours.');
  end if;

  select u.contact_id into v_contact from public.app_users u where u.id = me;
  -- Yours to take back, or the site runner's to clear. Somebody else's words
  -- on a job you do not run are not yours to delete.
  if not (public.is_superadmin()
          or (v_contact is not null and c.author_contact_id = v_contact)
          or coalesce(public.my_authority_rank(a.project_id), 0) >= 50) then
    return jsonb_build_object('ok', false, 'reason', 'Only whoever wrote it, or whoever runs this job, can take it back.');
  end if;

  -- The files stay on the project; they simply stop riding along with this
  -- entry. A photograph of the work is worth keeping even when the sentence
  -- attached to it was wrong.
  delete from public.file_links where action_comment_id = p_id;
  delete from public.action_comments where id = p_id;
  return jsonb_build_object('ok', true, 'action_id', c.action_id);
end $$;
revoke all on function public.portal_task_note_delete(uuid) from public, anon;
grant execute on function public.portal_task_note_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- EDIT A TRANSACTION.
--
-- Same gate as logging one (fin_may_record), because correcting a payment and
-- recording one are the same authority. Only the fields a person can be wrong
-- about: what it was, how much, when, how, the reference, the account, who was
-- paid, and where it stands. Never which project or contract it belongs to -
-- moving money between jobs is not an edit, it is a different transaction.
create or replace function public.portal_transaction_edit(p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me       uuid := public.current_app_user_id();
  t        public.transactions;
  pm       public.payment_methods;
  v_status text;
  v_method uuid;
  v_payee  uuid;
  v_name   text;
  n        int;
  changed  text[] := '{}';
  has      boolean;
  v_amount numeric;
  v_paid   date;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;

  select * into t from public.transactions where id = p_id;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'No such payment.'); end if;
  if t.project_id is null then
    return jsonb_build_object('ok', false, 'reason', 'That payment is not on a project.');
  end if;
  if not public.fin_may_record(t.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Money on this project is not yours to change.');
  end if;

  -- WHAT IT WAS
  if p_patch ? 'description' then
    if nullif(btrim(p_patch->>'description'), '') is distinct from t.description then
      update public.transactions set description = nullif(btrim(p_patch->>'description'), '') where id = p_id;
      changed := changed || 'what it was';
    end if;
  end if;

  -- HOW MUCH
  if p_patch ? 'amount' then
    v_amount := nullif(btrim(p_patch->>'amount'), '')::numeric;
    if v_amount is null or v_amount <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'An amount has to be a number above zero.');
    end if;
    if v_amount is distinct from t.amount then
      update public.transactions set amount = v_amount where id = p_id;
      changed := changed || 'amount';
    end if;
  end if;

  -- WHEN
  if p_patch ? 'paid_on' then
    v_paid := nullif(btrim(p_patch->>'paid_on'), '')::date;
    if v_paid is null then
      return jsonb_build_object('ok', false, 'reason', 'A payment needs the day it moved.');
    end if;
    if v_paid > current_date then
      return jsonb_build_object('ok', false, 'reason', 'That day has not happened yet.');
    end if;
    if v_paid is distinct from t.paid_on then
      update public.transactions set paid_on = v_paid where id = p_id;
      changed := changed || 'date';
    end if;
  end if;

  -- HOW, AND ITS REFERENCE. Checked together: a rail that needs a reference
  -- must not be left without one by an edit either.
  if p_patch ? 'method' then
    v_method := nullif(btrim(p_patch->>'method'), '')::uuid;
    select * into pm from public.payment_methods where id = v_method and is_active;
    if pm.id is null then return jsonb_build_object('ok', false, 'reason', 'Pick how it was paid.'); end if;
    if pm.settlement_type = 'processor' then
      return jsonb_build_object('ok', false, 'reason', format('%s is collected in the app, not logged by hand.', pm.name));
    end if;
    if coalesce(pm.requires_reference, false)
       and nullif(btrim(coalesce(p_patch->>'reference', t.payment_reference)), '') is null then
      return jsonb_build_object('ok', false, 'reason',
        format('%s needs a reference (%s). A payment without one cannot be reconciled later.',
               pm.name, coalesce(pm.notes, 'confirmation number')));
    end if;
    if v_method is distinct from t.payment_method_id then
      update public.transactions set payment_method_id = v_method, paid_via = pm.name where id = p_id;
      changed := changed || 'how it was paid';
    end if;
  end if;

  if p_patch ? 'reference' then
    if nullif(btrim(p_patch->>'reference'), '') is distinct from t.payment_reference then
      update public.transactions set payment_reference = nullif(btrim(p_patch->>'reference'), '') where id = p_id;
      changed := changed || 'reference';
    end if;
  end if;

  if p_patch ? 'from_account' then
    if nullif(btrim(p_patch->>'from_account'), '') is distinct from t.paid_from_account then
      update public.transactions set paid_from_account = nullif(btrim(p_patch->>'from_account'), '') where id = p_id;
      changed := changed || 'account';
    end if;
  end if;

  if p_patch ? 'notes' then
    if nullif(btrim(p_patch->>'notes'), '') is distinct from t.notes then
      update public.transactions set notes = nullif(btrim(p_patch->>'notes'), '') where id = p_id;
      changed := changed || 'note';
    end if;
  end if;

  -- WHO WAS PAID. A name that matches nothing on file becomes a contact, the
  -- same rule task_payment_log runs on; an ambiguous one is refused rather
  -- than guessed.
  if p_patch ? 'payee' then
    v_name := nullif(btrim(p_patch->>'payee'), '');
    if v_name is null then
      return jsonb_build_object('ok', false, 'reason', 'Say who was paid.');
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
      insert into public.contacts (name, person_name, source, created_by)
      values (v_name, v_name, 'transaction edit', 'portal:transaction-edit')
      returning id into v_payee;
    end if;
    if v_payee is distinct from t.contractor_id then
      update public.transactions set contractor_id = v_payee where id = p_id;
      changed := changed || 'who was paid';
    end if;
  end if;

  -- WHERE IT STANDS. Only the endings a person can honestly choose by hand -
  -- the rest of the lifecycle is driven by the money screens.
  if p_patch ? 'status' then
    v_status := nullif(btrim(p_patch->>'status'), '');
    if v_status is not null and v_status not in
       ('paid', 'paid - pending confirmation', 'paid - receipt filed', 'refunded', 'disputed', 'cancelled') then
      return jsonb_build_object('ok', false, 'reason', 'That is not a state you can set by hand.');
    end if;
    if v_status is not null and v_status is distinct from t.status then
      update public.transactions set status = v_status where id = p_id;
      changed := changed || ('marked ' || v_status);
    end if;
  end if;

  if array_length(changed, 1) is null then
    return jsonb_build_object('ok', true, 'changed', '[]'::jsonb, 'nothing', true);
  end if;
  update public.transactions
     set last_modified_by = 'portal', last_modified_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'changed', to_jsonb(changed));
end $$;
revoke all on function public.portal_transaction_edit(uuid, jsonb) from public, anon;
grant execute on function public.portal_transaction_edit(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A REFUNDED PAYMENT IS NOT MONEY OWED.
--
-- The only roll-up that had to learn the word: portal_my_work's "owed" works
-- by EXCLUDING the settled statuses, so anything it does not know about comes
-- back as an outstanding obligation. Everything else (portal_finance_rollup,
-- the close and cancel reports, the week) works by naming the statuses that
-- count, and 'refunded' is in none of those lists - which is exactly right.
CREATE OR REPLACE FUNCTION public.portal_my_work()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (
    select u.id as app_user_id, u.contact_id
      from app_users u where u.id = public.current_app_user_id()
  ),
  seats as (
    select pm.project_id,
           max(coalesce(pr.authority_rank, 0)) as rank,
           (array_agg(coalesce(pm.project_role, pm.role) order by coalesce(pr.authority_rank, 0) desc))[1] as seat
      from me, project_members pm
      left join project_roles pr on pr.role = pm.project_role
     where pm.status = 'active'
       and (pm.app_user_id = me.app_user_id
            or (pm.app_user_id is null and pm.contact_id = me.contact_id))
     group by pm.project_id
  ),
  bidstate as (
    select b.project_id,
           bool_or(b.won or b.status = 'awarded') as awarded,
           bool_or(b.status = 'invited') as invited,
           bool_or(b.status in ('received','under negotiation')) as submitted,
           max(b.amount) as amount,
           (array_agg(b.id order by b.created_at desc))[1] as latest_bid_id
      from bids b, me where b.bidder_contact_id = me.contact_id group by b.project_id
  ),
  owed as (
    select t.project_id, sum(coalesce(t.amount, 0)) as amount, count(*) as n
      from transactions t, me
     where t.direction = 'out' and t.contractor_id = me.contact_id
       and coalesce(t.status,'') not in ('paid','paid - receipt filed','paid - pending confirmation','settled','cancelled','void','refunded')
     group by t.project_id
  ),
  ids as (
    select project_id from seats
    union select project_id from bidstate
    union select project_id from owed
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', p.id,
    'project_name', p.project_name,
    'address', p.address,
    'status', p.status,
    'stage', p.stage,
    'domain', p.domain,
    'parent_project_id', p.parent_project_id,
    'parent_name', (select pp.project_name from projects pp where pp.id = p.parent_project_id),
    'household', p.home_blueprint_code is not null,
    'seat', s.seat,
    'rank', coalesce(s.rank, 0),
    'cover', (select f.path from files f where f.id = public.project_face_photo_id(p.id)),
    'cover_own', p.cover_file_id is not null,
    'cover_url', public.project_face_url(p.id),
    'package_code', p.package_code,
    'my_open_tasks', (select count(*) from actions a, me
                       where a.project_id = p.id and a.assigned_to_contact_id = me.contact_id
                         and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')),
    'bid_amount', b.amount,
    'latest_bid_id', b.latest_bid_id,
    'owed', coalesce(o.amount, 0),
    'owed_count', coalesce(o.n, 0),
    'buckets', (
      select coalesce(jsonb_agg(q.x), '[]'::jsonb) from (
        select 'done'::text as x where p.status like 'Closed%'
        union all
        select 'active' where p.status = 'In Progress'
          and (s.project_id is not null or coalesce(b.awarded, false))
        union all
        select 'lead' where p.status = 'In Progress' and coalesce(b.invited, false)
        union all
        select 'decision' where coalesce(b.submitted, false)
        union all
        select 'payment' where coalesce(o.n, 0) > 0
      ) q)
  ) order by p.project_name), '[]'::jsonb)
  from ids
  join projects p on p.id = ids.project_id and p.trashed_at is null and not p.is_template
                 and p.disabled_at is null
  left join seats s on s.project_id = p.id
  left join bidstate b on b.project_id = p.id
  left join owed o on o.project_id = p.id;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
