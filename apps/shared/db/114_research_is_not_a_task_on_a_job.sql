-- 114. RESEARCH IS NOT A TASK ON A JOB.
--
-- Shahar (2026-09-14), looking at Ran's generator: "in generator task - why
-- these shows as tasks. remove them from here, as well as from the parent
-- blue print."
--
-- Three of them, all assigned to ranbaror, all seeded 2026-09-03 from the
-- "Hire contractor" activity blueprint:
--
--   Pull global contract knowledge
--   Pull trade-specific learnings
--   Pull project-specific context
--
-- They are not work. They are the reading somebody does BEFORE writing the
-- addendum - "query help where at_contract_signing = true", "query learnings
-- where trade = the trade being contracted" - written as instructions to
-- Contracto, the persona that drafts the thing. Turning them into three
-- checkboxes on a homeowner's generator job put database queries on a list
-- next to "collect the certificate of insurance", under the homeowner's own
-- name, where he can only ever ignore them.
--
-- The knowledge does not go. It moves to the step it was always in service
-- of: step 4 drafts the addendum, and now its note says what to read first.
-- One task that produces something, instead of four where three produce
-- nothing anybody can see.

-- 1. The step that survives carries what the other three knew.
update public.blueprint_activity_steps
   set step_name = 'Draft the addendum',
       notes = 'Read first, then draft - all three of these, in this order. '
            || 'GLOBAL: help where at_contract_signing = true, learnings where trade in (''ALL'',''Meta''), '
            || 'and learnings where add_to_contract = true regardless of trade - these apply to every contract and every trade. '
            || 'TRADE: learnings where trade = the trade being contracted. Read every row, do not sample. '
            || 'THIS JOB: learnings and actions scoped to this project_id, the relevant scope_blueprint, prior contracts '
            || 'on this project, and the budget line for the trade. '
            || 'Then turn every applicable learning into an explicit clause or scope line. The addendum is a NEGOTIATING '
            || 'INSTRUMENT and goes out WITH the bid package, so every contractor prices the work with these terms already '
            || 'included and nobody can claim surprise later.'
 where id = '55adf90a-230c-436a-bc6e-cb05b9dccdb6';

-- 2. The three reading steps come off the blueprint, so no future job is
--    seeded with them again.
delete from public.blueprint_activity_steps
 where id in ('77f11cd1-1469-4518-bb73-f8a1775a0ddf',
              '25528e1a-2bee-40c4-97ea-2bcf45b97c21',
              '7a04ad6c-3ea1-423b-93c1-8f10a4e27502');

-- 3. And off the one job they ever reached. Checked first: nothing hangs off
--    them - no sub-tasks, no files, no money, no contract, no learnings - so
--    there is nothing to orphan and nothing worth keeping a cancelled row for.
delete from public.actions
 where source = 'system:blueprint'
   and status = 'Not Started'
   and action in ('Pull global contract knowledge',
                  'Pull trade-specific learnings',
                  'Pull project-specific context')
   and not exists (select 1 from public.actions c where c.parent_action_id = actions.id)
   and not exists (select 1 from public.file_links f where f.action_id = actions.id)
   and not exists (select 1 from public.transactions t where t.action_id = actions.id)
   and not exists (select 1 from public.contracts k where k.action_id = actions.id);

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
