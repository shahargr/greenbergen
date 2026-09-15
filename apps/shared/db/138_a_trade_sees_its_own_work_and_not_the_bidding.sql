-- 138. A TRADE SEES ITS OWN WORK, AND NOT THE BIDDING.
--
-- Shahar (2026-09-15): "since the trade have visibility to what's in the
-- trade, and I don't want them to see the bids information from other
-- vendors, do you think that the bids information should move over to the
-- PM side?"
--
-- The answer was no - moving the bid is treating a hole in the fence by
-- moving the garden. The ladder already existed and was already right:
-- can_see_action bounds a contractor to their own contract and their own
-- crew. What was wrong is that nothing on the task surface CALLED it.
--
-- Measured before this migration, acting as the contractor seat on Ran's
-- generator: portal_tasks returned 18 rows, among them "Bid to 3
-- contractors", "Review proposals", "Update proposals" and "Negotiate".
-- Real projects carry real sentences in those rows - "AWARDED to Javier
-- Rivera - $35,000 incl. shed. Not selected: ..." - so this is not a
-- theoretical leak. Three separate faults, all fixed here.

-- ---------------------------------------------------------------------------
-- FAULT ONE. THE BOUND WAS DRAWN FROM PAPERWORK, NOT FROM STANDING.
--
-- The old rule: you are contract-bounded if you hold at least one seat WITH
-- a contract and no seat WITHOUT one. It reads like a rule about contracts
-- but it is really a rule about paperwork being complete, and it fails open:
-- a contractor admitted to a job before their contract exists holds one seat
-- with a null contract_id, so the test says "not bounded" and they see the
-- whole job. Exactly one live seat is in that state today, and it is the one
-- that produced the 18 rows above.
--
-- Standing is the honest test. A member is bounded when the highest
-- authority they hold anywhere in the project family is contractor or below
-- (rank 30). That keeps every case the old clause was protecting - the GC who
-- also holds a subcontract is rank 60 and unbounded, the owner is rank 70 -
-- and closes the hole, because a contractor with no contract yet is still a
-- contractor. Having no contract then means seeing only what is assigned to
-- their own crew, which is the truthful answer rather than a generous one.
--
-- Rank 0 (a supplier, an inspector, a consultant) is bounded too. No rank-0
-- seat carries a login today, so nothing changes underfoot; going forward a
-- utility that logs in does not get to read the job's negotiations either.
create or replace function public.is_contract_bounded_member(p_project_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select not public.is_superadmin()
     and public.my_authority_rank(p_project_id) <= 30
$function$;

comment on function public.is_contract_bounded_member(uuid) is
'Whether this member is held to their own contract and their own crew on this project family. True when the highest authority they hold anywhere in the family is contractor or below (rank 30) - migration 138 moved this off "does every seat carry a contract", which failed open for a contractor admitted before their paperwork existed. A non-member reads as bounded, which is the safe direction; membership itself is checked by the callers.';

-- ---------------------------------------------------------------------------
-- BIDDING IS OUR SIDE OF THE TABLE, AND IT HAS NO CONTRACT TO HIDE BEHIND.
--
-- The four Build steps do not divide evenly. Define the scope and Contractor
-- selection happen BEFORE anyone is chosen: there is no counterparty yet, so
-- there is nothing to show a counterparty, and the second one holds every
-- other bidder's number. Legal and insurance and the delivery that follows
-- carry the awarded contract and are meant to be read by the trade that won.
--
-- Today the first two are invisible only by accident - they carry no
-- contract, and the bound is drawn on contracts. That accident ends the
-- moment somebody names a payee while comparing bids, because migration 134
-- binds a contract to any task that names one. So say it as a property of the
-- row instead of leaving it to arithmetic.
alter table public.actions
  add column if not exists hidden_from_trades boolean not null default false;

comment on column public.actions.hidden_from_trades is
'True on work that belongs to our side of the table and is never shown to a counterparty, however the rest of the ladder falls out - the bid comparison above all. A contract-bounded member is refused these rows even when the task carries their contract or names their crew, and fn_actions_ensure_contract will not bind a contract to one.';

-- The rule wherever the money trigger runs: a row that the trades may not see
-- must not acquire a contract, because a contract is the one thing that would
-- make it visible to one of them.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_actions_ensure_contract';

  out_ := replace(src,
    E'  if new.contract_id is not null then return new; end if;\n',
    E'  if new.contract_id is not null then return new; end if;\n'
    || E'  if coalesce(new.hidden_from_trades, false) then return new; end if;\n');

  if out_ = src then
    raise exception 'fn_actions_ensure_contract has drifted - the contract_id guard is not where it was.';
  end if;
  execute out_;
end $patch$;

-- The blueprint decides it once, where the step is written, rather than every
-- screen deciding it again.
alter table public.blueprint_activity_steps
  add column if not exists hidden_from_trades boolean not null default false;

comment on column public.blueprint_activity_steps.hidden_from_trades is
'Marks a step that is ours alone - scoping and bid comparison - so every task expanded from it starts hidden from the trades. Carried into actions.hidden_from_trades by fn_actions_expand_blueprint.';

update public.blueprint_activity_steps s
   set hidden_from_trades = true
 where s.step_name in ('Define the scope', 'Contractor selection')
   and s.activity_blueprint_id in (
     select b.id from public.blueprint_activity b
      where b.name = 'Build - a trade package');

do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_actions_expand_blueprint';

  out_ := replace(src,
    E'    source, created_by, notes, step_order\n  )',
    E'    source, created_by, notes, step_order, hidden_from_trades\n  )');
  out_ := replace(out_,
    E'         s.notes,\n         s.step_order\n  FROM',
    E'         s.notes,\n         s.step_order,\n         coalesce(s.hidden_from_trades, false)\n  FROM');

  if out_ = src then
    raise exception 'fn_actions_expand_blueprint has drifted - the insert list is not where it was.';
  end if;
  execute out_;
end $patch$;

-- The steps already written down, before the blueprint knew to say it.
update public.actions a
   set hidden_from_trades = true
 where a.hidden_from_trades = false
   and a.action in ('Define the scope', 'Contractor selection')
   and exists (select 1 from public.actions p
                where p.id = a.parent_action_id and p.action_type = 'build');

-- ---------------------------------------------------------------------------
-- THE LADDER ITSELF, saying the new rule out loud.
--
-- Two changes beyond the column. The rank >= 30 test on the contract arm is
-- gone: it was there to stop a rank-0 seat reading a contract, but a rank-0
-- seat that HOLDS the contract - a surveyor, an engineering consultant, all
-- of them under contract today - should read their own work. If the contract
-- is yours, the work under it is yours to see.
create or replace function public.can_see_action(p_action_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select public.is_superadmin() or exists (
    select 1 from public.actions a
     where a.id = p_action_id
       and public.is_project_member(a.project_id)
       and (not public.is_contract_bounded_member(a.project_id)
            or (not a.hidden_from_trades
                and ((a.contract_id in (select contract_id from public.my_contract_ids(a.project_id)))
                     or (a.assigned_to_contact_id is not null
                         and a.assigned_to_contact_id in
                             (select contact_id from public.my_team_contact_ids(a.project_id)))))))
$function$;

comment on function public.can_see_action(uuid) is
'Whether the caller may read this task. Everyone on the job sees all of it unless they are contract-bounded (migration 138: contractor rank or below); a bounded member sees work under a contract of theirs, or assigned to their own crew, and never a row marked hidden_from_trades - the bid comparison is ours.';

-- ---------------------------------------------------------------------------
-- FAULT TWO AND THREE. THE TASK SURFACE NEVER ASKED.
--
-- portal_tasks filtered on project membership alone. portal_task_detail
-- gated on is_project_member. Both predate the ladder and neither was ever
-- brought to it, so every rule above has been decorative on the one surface
-- where tasks are actually read.
--
-- The bound is computed once per project rather than once per row: it walks
-- the project ancestry, and a board query answers for a couple of hundred
-- tasks at a time. The two set-returning lookups stay per-row but only run
-- for a bounded member, which is the rare case and the small list.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_tasks';

  out_ := replace(src,
    E'\n),\nbase as (\n',
    E'\n),\nvis as (\n'
    || E'  select m.project_id,\n'
    || E'         public.is_contract_bounded_member(m.project_id) as bounded\n'
    || E'    from my_ids m\n'
    || E'),\nbase as (\n');

  out_ := replace(out_,
    E'  join my_ids m on m.project_id = a.project_id\n'
    || E'  where (p_project_id is null or a.project_id = p_project_id)\n'
    || E'    and (p_domain is null or a.domain = p_domain)\n)',
    E'  join vis m on m.project_id = a.project_id\n'
    || E'  where (p_project_id is null or a.project_id = p_project_id)\n'
    || E'    and (p_domain is null or a.domain = p_domain)\n'
    || E'    and (not m.bounded\n'
    || E'         or (not coalesce(a.hidden_from_trades, false)\n'
    || E'             and ((a.contract_id in (select contract_id from public.my_contract_ids(a.project_id)))\n'
    || E'                  or (a.assigned_to_contact_id is not null\n'
    || E'                      and a.assigned_to_contact_id in\n'
    || E'                          (select contact_id from public.my_team_contact_ids(a.project_id))))))\n)');

  if out_ = src then
    raise exception 'portal_tasks has drifted - the my_ids join is not where it was.';
  end if;
  execute out_;
end $patch$;

do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_detail';

  out_ := replace(src,
    'not public.is_project_member(a.project_id)',
    'not public.can_see_action(a.id)');

  if out_ = src then
    raise exception 'portal_task_detail has drifted - the membership gate is not where it was.';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
