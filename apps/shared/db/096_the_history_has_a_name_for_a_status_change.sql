-- 096 - The history has a name for a status change.
--
-- 095 renamed the field but not the event the change log files it under, so
-- the first edit to a status raised a foreign key violation from
-- log_action_event - caught by a probe before anybody met it on the screen.
--
-- The history moves with the field rather than splitting across two names:
-- the new type goes in, every existing event is re-pointed at it, and the old
-- name goes. The foreign key has no ON UPDATE CASCADE, which is why this is
-- three steps and not a rename.
insert into public.action_event_types (event_type, description, is_field_change)
values ('status_note_change',
        'The status line was rewritten - where the task stands changed. from/to hold the SIZE of each version; the text is in change_bodies until it is pruned. Was pending_reason_change before migration 095.',
        true)
on conflict (event_type) do nothing;

update public.action_events
   set event_type = 'status_note_change'
 where event_type = 'pending_reason_change';

delete from public.action_event_types where event_type = 'pending_reason_change';

do $$
declare n int;
begin
  select count(*) into n from public.action_event_types where event_type = 'status_note_change';
  if n <> 1 then raise exception 'EVENT_TYPE_MISSING: status_note_change'; end if;
  select count(*) into n from public.action_event_types where event_type = 'pending_reason_change';
  if n <> 0 then raise exception 'EVENT_TYPE_STALE: pending_reason_change survived'; end if;
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
