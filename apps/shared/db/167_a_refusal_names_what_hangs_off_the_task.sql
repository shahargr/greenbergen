-- 167. A REFUSAL NAMES WHAT HANGS OFF THE TASK.
--
-- Shahar (2026-09-17), deleting the loan process after its spare steps had
-- gone: "Other tasks hang off this one. Cancel it instead." - and no way to
-- see which, or whether they could go first.
--
-- The rule stands: a task with steps beneath it is not "entered by mistake,
-- nothing to keep". But the refusal now says what is beneath it - up to five
-- by name, with a mark on the ones that carry a note, a file or a payment
-- and so cannot go either - so the person knows in one read whether to
-- clear the steps first or call the whole thing off.

do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef('public.portal_task_delete(uuid)'::regprocedure) into src;
  out_ := replace(src,
    $a$  if n > 0 then return jsonb_build_object('ok', false, 'code', 'HAS_CHILDREN', 'reason', 'Other tasks hang off this one. Cancel it instead.'); end if;$a$,
    $b$  if n > 0 then
    return jsonb_build_object('ok', false, 'code', 'HAS_CHILDREN', 'reason',
      n || ' task' || case when n = 1 then ' hangs' else 's hang' end || ' off this one: '
      || (select string_agg(
             '"' || k.action || '"'
             || case when exists (select 1 from public.action_comments c where c.action_id = k.id)
                       or exists (select 1 from public.file_links f where f.action_id = k.id)
                       or exists (select 1 from public.transactions t where t.action_id = k.id)
                     then ' (has a record - call it off)' else '' end,
             '; ' order by k.step_order nulls last, k.created_at)
            from (select * from public.actions x
                   where x.parent_action_id = p_action_id or x.recurrence_source_action_id = p_action_id or x.follows_action_id = p_action_id
                   limit 5) k)
      || case when n > 5 then '; and ' || (n - 5) || ' more' else '' end
      || '. Remove those first, or call this one off - calling it off keeps the record and closes what is open beneath it.');
  end if;$b$);
  if out_ = src then raise exception 'portal_task_delete has drifted - the HAS_CHILDREN guard was not found'; end if;
  execute out_;
end $patch$;

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
