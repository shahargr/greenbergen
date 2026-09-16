-- 146. A NEW PARAMETER MAKES A NEW FUNCTION, NOT A NEW VERSION.
--
-- Shahar (2026-09-16), trying to log a masonry task on New build:
--
--   Could not choose the best candidate function between:
--     public.portal_task_quick(p_project => uuid, p_action => text,
--       p_trade => text, p_target_date => date, p_assignee => uuid,
--       p_priority => text, p_parent => uuid),
--     public.portal_task_quick(p_project => uuid, p_action => text,
--       p_trade => text, p_target_date => date, p_assignee => uuid,
--       p_priority => text, p_parent => uuid, p_delivers => text,
--       p_file_ids => uuid[])
--
-- THE MISTAKE, which is worth naming because it looks exactly like success.
-- CREATE OR REPLACE FUNCTION replaces a function with the SAME SIGNATURE. The
-- argument list is part of the identity, so adding a parameter - even one with
-- a default, even at the end - creates a SECOND function and leaves the first
-- standing. The migration reports success. The old body is still there. And
-- any caller whose arguments fit both is now ambiguous, which PostgREST
-- reports as the wall of text above.
--
-- Migration 142 did it to portal_note_add (adding p_intent) and
-- portal_note_to_task (adding p_project); migration 145 did it again to
-- portal_note_add (p_file_ids) and to portal_task_quick (p_delivers,
-- p_file_ids). Six signatures where there should have been three. Every
-- quick-task box in the Professionals app was dead from the moment 145
-- shipped - the trade screen's "Log a ... task", and the sheet's To do and
-- Order tabs with it.
--
-- The newest of each already does everything the older one did, which is
-- precisely why they were written as replacements. So the fix is to drop what
-- should never have survived.
--
-- THE RULE, for the next one: when a migration adds a parameter to an
-- existing function, it must DROP the old signature in the same migration.
-- Check with:
--   select proname, count(*) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prokind = 'f'
--    group by proname having count(*) > 1;
drop function if exists public.portal_task_quick(uuid, text, text, date, uuid, text, uuid);
drop function if exists public.portal_note_add(text, uuid, text, uuid, text);
drop function if exists public.portal_note_add(text, uuid, text, uuid, text, text);
drop function if exists public.portal_note_to_task(uuid, text, date, uuid);

-- The same trap, older and not from this session: public_tagline_set('x')
-- matches both the one-argument version and the two-argument one whose second
-- argument has a default, and has been ambiguous for as long as both existed.
-- The two-argument version supersedes the other, so the landmine comes out
-- while the ground is open.
--
-- may_create_project is NOT this. Its three signatures take 0, 1 and 2
-- arguments with no defaults anywhere, so every call resolves to exactly one
-- of them. Those are deliberate overloads and they stay.
drop function if exists public.public_tagline_set(text);

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
