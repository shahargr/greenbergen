-- 189: WRITE IT DOWN AND PAY IT IN ONE MOVE.
--
-- Shahar (2026-09-18): "When I'm logging a task for an activity I wanna be
-- able to log a payment as well. I believe that we spoke about different
-- types of tasks but never developed the payment or maybe we have."
--
-- We have - both halves, and they were never joined up:
--
--   action_types      seven kinds of task, two of them carrying needs_money:
--                     build and financial transaction hold a target cost and
--                     a payee BEFORE any payment exists. portal_task_create
--                     has taken p_type since it was written.
--   task_payment_log  the whole ledger write - amount, method, both account
--                     ends, payee, reference, receipts, credits - with every
--                     money rule in it (fin_may_record, the method
--                     vocabulary, references, one end named and not both).
--
-- What was missing is the road between them. portal_task_quick - the one-line
-- box on a trade screen, which is where things actually get written down -
-- passed no type at all, so every quick task landed untyped (528 of 577 rows
-- in actions have none), and money could only be logged afterwards, from a
-- different screen, against a task you had to go and find.
--
-- Applied as 189a and 189b.

-- ---------------------------------------------------------------------------
-- 189a  A quick task can say what kind it is
-- ---------------------------------------------------------------------------
create or replace function public.portal_task_quick(
  p_project uuid, p_action text, p_trade text default null, p_target_date date default null,
  p_assignee uuid default null, p_priority text default null, p_parent uuid default null,
  p_delivers text default 'work', p_file_ids uuid[] default null, p_is_gate boolean default false,
  p_type text default null, p_target_cost numeric default null, p_pay_to_contact uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_id uuid; v_delivers text; v_gate boolean;
begin
  v_delivers := case when lower(coalesce(p_delivers, 'work')) = 'product' then 'product' else 'work' end;
  v_gate := coalesce(p_is_gate, false);

  -- portal_task_create owns every rule here, the type vocabulary included -
  -- it reads action_types and refuses a kind we do not have.
  r := public.portal_task_create(
    p_project => p_project,
    p_action  => p_action,
    p_type    => nullif(btrim(coalesce(p_type, '')), ''),
    p_delivers => v_delivers,
    p_target_cost => p_target_cost,
    p_pay_to_contact => p_pay_to_contact,
    -- A gate is the high-priority thing by definition. Anything explicitly
    -- asked for still wins, so a caller can say otherwise on purpose.
    p_priority => coalesce(p_priority, case when v_gate then 'High' end),
    p_target_date => p_target_date,
    p_assignee => p_assignee,
    p_parent => p_parent,
    p_trade => p_trade,
    p_file_ids => p_file_ids,
    p_is_gate => v_gate);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;

  v_id := (r->>'id')::uuid;
  update public.actions set accepts_steps = false where id = v_id;

  return r || jsonb_build_object('simple', true, 'delivers', v_delivers, 'is_gate', v_gate);
end $$;
revoke all on function public.portal_task_quick(uuid, text, text, date, uuid, text, uuid, text, uuid[], boolean, text, numeric, uuid) from public, anon;
grant execute on function public.portal_task_quick(uuid, text, text, date, uuid, text, uuid, text, uuid[], boolean, text, numeric, uuid) to authenticated;

-- The old shape, or every call becomes ambiguous. Both callers (the trade
-- screen's QuickTask and the Notebook) pass named arguments that all still
-- exist, so they resolve to this one untouched.
drop function if exists public.portal_task_quick(uuid, text, text, date, uuid, text, uuid, text, uuid[], boolean);

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 189b  Write it down and pay it in one move
-- ---------------------------------------------------------------------------
-- The two acts have always been two screens. You are standing on site, you
-- just handed the framer a check, and to record it you had to: log a task on
-- the trade screen, leave, open the pay screen, choose the category, find the
-- task you just made in the list, and only then type the amount. Four of
-- those five steps exist because the data model wanted them, not because
-- anybody needed them.
--
-- THIS OWNS NO MONEY RULES. Every one of them is task_payment_log's and stays
-- there: what a valid payment method is, that a processor method cannot be
-- logged by hand, that some methods need a reference, that one end of the
-- money is named and not both, that fin_may_record() says whether logging
-- money on this project is yours to do. This only spares you the walk between
-- two screens.
--
-- IF THE PAYMENT IS REFUSED THE TASK GOES WITH IT. Otherwise a rejected
-- payment leaves a stray task behind that says nothing and nobody asked for -
-- and you would make a second one on the retry. It is one act, so it either
-- lands or it does not.
create or replace function public.portal_task_quick_paid(
  p_project uuid, p_action text, p_amount numeric, p_method uuid,
  p_trade text default null, p_target_date date default null, p_parent uuid default null,
  p_file_ids uuid[] default null,
  p_payee_contact uuid default null, p_payee_name text default null,
  p_from_account text default null, p_to_account text default null,
  p_reference text default null, p_paid_on date default null,
  p_notes text default null, p_awaiting boolean default false,
  p_receipt_ids uuid[] default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; pay jsonb; v_id uuid;
begin
  perform public.assert_own_hands();

  -- MONEY CHANGED HANDS, so this is a financial transaction whatever else it
  -- is about. The kind is not a question worth asking somebody holding a
  -- receipt in a driveway.
  r := public.portal_task_quick(
    p_project => p_project,
    p_action => p_action,
    p_trade => p_trade,
    p_target_date => p_target_date,
    p_parent => p_parent,
    p_file_ids => p_file_ids,
    p_type => 'financial transaction',
    -- What it cost is what it was expected to cost: you are recording it
    -- after the fact, so the intent and the actual are the same number.
    p_target_cost => p_amount,
    p_pay_to_contact => p_payee_contact);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  v_id := (r->>'id')::uuid;

  pay := public.task_payment_log(
    p_action => v_id,
    p_amount => p_amount,
    p_method => p_method,
    p_payee_contact => p_payee_contact,
    p_payee_name => p_payee_name,
    p_reference => p_reference,
    p_paid_on => p_paid_on,
    p_from_account => p_from_account,
    p_to_account => p_to_account,
    p_notes => p_notes,
    p_awaiting => coalesce(p_awaiting, false),
    p_file_ids => p_receipt_ids);

  if not coalesce((pay->>'ok')::boolean, false) then
    -- One act, so it either lands or it does not: no stray task, and no
    -- second one when they fix the amount and press it again.
    delete from public.actions where id = v_id;
    return pay;
  end if;

  return r || jsonb_build_object('paid', true, 'payment', pay, 'amount', p_amount);
end $$;
revoke all on function public.portal_task_quick_paid(uuid, text, numeric, uuid, text, date, uuid, uuid[], uuid, text, text, text, text, date, text, boolean, uuid[]) from public, anon;
grant execute on function public.portal_task_quick_paid(uuid, text, numeric, uuid, text, date, uuid, uuid[], uuid, text, text, text, text, date, text, boolean, uuid[]) to authenticated;

comment on function public.portal_task_quick_paid is
  'One move: write the task down and log the payment against it. Owns no money rules - task_payment_log keeps every one of them - and removes the task again if the payment is refused, so a rejected payment leaves nothing behind.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
