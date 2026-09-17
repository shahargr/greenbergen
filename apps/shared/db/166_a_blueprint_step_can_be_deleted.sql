-- 166. A BLUEPRINT STEP NOBODY HAS TOUCHED CAN BE DELETED.
--
-- Shahar (2026-09-17), ticking "Delete it for good" on "Keep the lender's
-- conditions met": refused with "The system made this task and reads it
-- back. Cancel it instead."
--
-- The refusal (060) was written for recurrence occurrences and ledger rows,
-- which the system does read back - a monthly chain re-dates itself, a
-- payment's task is written from the payment. It swept in every row with a
-- system: source, including the steps a blueprint laid down when a process
-- was started. Those are written ONCE (trg_actions_expand_blueprint runs on
-- insert or on a change of blueprint, never again) and a step the house does
-- not need is exactly what "entered by mistake, nothing to keep" means.
--
-- So the rule narrows to what is true: a recurrence occurrence and a
-- ledger-written task are still refused; a blueprint step, a loan step, a
-- package milestone can go once every other guard (notes, files, children,
-- money) has passed.

do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef('public.portal_task_delete(uuid)'::regprocedure) into src;
  out_ := replace(src,
    $a$  if a.source like 'system:%' then
    return jsonb_build_object('ok', false, 'code', 'SYSTEM', 'reason', 'The system made this task and reads it back. Cancel it instead.');
  end if;$a$,
    $b$  -- 166: only what the system actually reads back is refused - a recurrence
  -- occurrence (the chain re-dates it) and a task written from a payment. A
  -- blueprint step is written once and may go.
  if a.source = 'system:recurrence' or a.source like 'system:ledger:%' or a.source like 'system:transaction:%' then
    return jsonb_build_object('ok', false, 'code', 'SYSTEM', 'reason', 'The system made this task and reads it back. Cancel it instead.');
  end if;$b$);
  if out_ = src then raise exception 'portal_task_delete has drifted - the SYSTEM guard was not found'; end if;
  execute out_;
end $patch$;

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
