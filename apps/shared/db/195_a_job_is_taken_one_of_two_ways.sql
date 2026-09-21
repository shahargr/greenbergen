-- 195: a job is taken one of two ways, and one of them owes you a checklist.
--
-- Shahar (2026-09-19): "if a task is taken it can be a DIY task or a fully
-- hired task, and a DIY task obviously will give you a checklist of
-- everything that needs to happen."
--
-- WHAT WAS ALREADY TRUE. The fork exists in the product - the package screen
-- offers "Start as DIY" beside "Order now", and homeowner_book takes
-- p_mode 'plan' or 'book'. What it did NOT do was write the difference down:
-- both modes produced a project_bookings row in state 'planned', so "I am
-- doing this myself" and "I have not posted it yet" were the same row. That
-- ambiguity has already cost us once, and it is on the record: three jobs at
-- 52 Ryerson that nobody had been asked about sat under "Lining up", as
-- though an offer were coming. Nothing was out on them. They were his own
-- work to do.
--
-- WHY A COLUMN AND NOT A DERIVATION (rulebook 34). Section 34 prefers a value
-- that falls out of data something else forces to be accurate, and the
-- derivation here is tempting: no contract and no posting means DIY. It is
-- wrong for the same reason the bug above was wrong - absence of a contractor
-- is not a decision, it is a silence, and the two readings of that silence
-- are exactly what the screen has to tell apart. This is a CHOICE somebody
-- makes at take-on, recorded once, not a progress field anybody has to
-- maintain.
--
-- AND THE CHECKLIST, which is the half that was missing entirely.
-- homeowner_book copied blueprint_package_items into project_scope_items and
-- created NO actions at all. Rulebook 42: a scope line that generates no task
-- is invisible - nobody reads a scope table, people work from the task list.
-- A DIY job whose steps live only in project_scope_items is a job nobody can
-- actually follow.

alter table public.projects
  add column if not exists delivery text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_projects_delivery') then
    alter table public.projects
      add constraint chk_projects_delivery check (delivery is null or delivery in ('diy', 'hired'));
  end if;
end $$;

comment on column public.projects.delivery is
  'How this job is being taken on: diy (the owner is doing it) or hired (somebody is being paid to). NULL means not decided yet, which is honest for a project that predates the choice. Set at take-on by homeowner_book and re-settable; it is a decision, not a progress field - see rulebook 34 for why it is not derived from the absence of a contract.';

-- Backfill from what the record already shows. A booking that was posted,
-- accepted or finished had somebody hired on it; one that never left
-- 'planned' was the owner's own. Projects with no booking are left NULL
-- rather than guessed at - most of them predate the fork entirely.
update public.projects p
   set delivery = case when b.state in ('posted','accepted','done') or b.contract_id is not null
                       then 'hired' else 'diy' end
  from public.project_bookings b
 where b.project_id = p.id
   and p.delivery is null;

update public.projects p
   set delivery = 'hired'
 where p.delivery is null
   and exists (select 1 from public.contracts c where c.project_id = p.id);
