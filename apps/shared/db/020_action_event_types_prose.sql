-- 020 - the three new event types the prose audit needs.
--
-- action_events.event_type is a foreign key to action_event_types, and the
-- constraint caught this on the first test: the vocabulary is a table, not a
-- string invented at the insert (rulebook 03). pending_reason_change was
-- already there, which is why only three are new.
insert into public.action_event_types (event_type, description, is_field_change) values
  ('action_change',          'The task title was rewritten. from/to hold the SIZE of each version; the text is in change_bodies until it is pruned.', true),
  ('notes_change',           'The notes were rewritten. from/to hold the SIZE of each version; the text is in change_bodies until it is pruned.', true),
  ('desired_outcome_change', 'The desired outcome was rewritten. from/to hold the SIZE of each version; the text is in change_bodies until it is pruned.', true)
on conflict (event_type) do update
  set description = excluded.description, is_field_change = excluded.is_field_change;

update public.action_event_types
   set description = 'pending_reason rewritten - the thing the task is waiting on changed. from/to hold the SIZE of each version; the text is in change_bodies until it is pruned.'
 where event_type = 'pending_reason_change';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
