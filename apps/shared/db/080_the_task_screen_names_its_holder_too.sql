-- 080  THE TASK SCREEN NAMES ITS HOLDER TOO
--
-- The companion to 079. portal_tasks now returns the holder whichever kind of
-- holder it is; portal_task_detail still read only the contact, so the SAME
-- task said "Bobby" in the list and "unassigned" on its own screen.
--
-- 'assignee' is left exactly as it was on purpose: the task screen's "Assigned
-- to" select is a list of CONTACTS and matches its default against that id, so
-- putting a persona id in there would silently blank the select. The holder is
-- a second, display-only pair beside it.

create or replace function public.portal_task_detail_holder(p_action uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when a.assigned_to_contact_id is not null then
      jsonb_build_object('name', (select coalesce(c.person_name, c.name) from public.contacts c
                                   where c.id = a.assigned_to_contact_id),
                         'kind', 'person')
    when a.assigned_to_persona_id is not null then
      jsonb_build_object('name', (select pe.name from public.personas pe
                                   where pe.id = a.assigned_to_persona_id),
                         'kind', 'assistant')
    else null end
  from public.actions a where a.id = p_action;
$$;

comment on function public.portal_task_detail_holder(uuid) is
  'Display-only: who holds a task, person or assistant. portal_task_detail folds it in as holder.';

-- Fold it into the detail read. Only two keys are added; everything else is
-- migration 065's function unchanged, so this is a targeted rewrite rather
-- than a re-statement of the whole body: the key is computed by the helper
-- above and the rest of the function is left where it is.
do $$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_detail';
  if src is null then raise exception 'portal_task_detail not found'; end if;
  if position('''holder''' in src) > 0 then
    raise notice 'holder already present; nothing to do';
    return;
  end if;
  patched := replace(src,
    '''assignee'', (select jsonb_build_object(''id'', c.id, ''name'', coalesce(c.person_name, c.name))
                   from contacts c where c.id = a.assigned_to_contact_id),',
    '''assignee'', (select jsonb_build_object(''id'', c.id, ''name'', coalesce(c.person_name, c.name))
                   from contacts c where c.id = a.assigned_to_contact_id),
      ''holder'', public.portal_task_detail_holder(a.id),');
  if patched = src then
    raise exception 'portal_task_detail did not match the expected assignee block - patch by hand';
  end if;
  execute patched;
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
