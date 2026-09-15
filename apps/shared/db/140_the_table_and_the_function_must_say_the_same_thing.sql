-- 140. THE TABLE AND THE FUNCTION MUST SAY THE SAME THING.
--
-- Migration 138 moved can_see_action - dropped the rank clause from the
-- contract arm, refused hidden_from_trades rows - and left two row policies
-- carrying their own inline copy of the OLD ladder: actions.action_access and
-- project_scope_items.scope_access. Both picked up the new bound for free
-- (they call is_contract_bounded_member), and neither picked up the rest.
--
-- Two copies of a rule is how the leak in 138 happened in the first place:
-- can_see_action was right for months while the surface that people actually
-- read never called it. So these are brought back into step now rather than
-- when somebody notices the direct-table path disagreeing with the function
-- path. The with_check stays inline rather than calling can_see_action,
-- because on an insert there is no committed row for the function to read.

drop policy if exists action_access on public.actions;
create policy action_access on public.actions
  for all
  using (
    public.is_project_member(project_id)
    and (not public.is_contract_bounded_member(project_id)
         or (not coalesce(hidden_from_trades, false)
             and ((contract_id in (select contract_id from public.my_contract_ids(project_id)))
                  or (assigned_to_contact_id is not null
                      and assigned_to_contact_id in
                          (select contact_id from public.my_team_contact_ids(project_id)))))))
  with check (
    public.is_project_member(project_id)
    and (not public.is_contract_bounded_member(project_id)
         or (not coalesce(hidden_from_trades, false)
             and ((contract_id in (select contract_id from public.my_contract_ids(project_id)))
                  or (assigned_to_contact_id is not null
                      and assigned_to_contact_id in
                          (select contact_id from public.my_team_contact_ids(project_id)))))));

-- A scope line has no hidden_from_trades of its own - it is the work, not the
-- bidding - so only the rank clause comes out, for the same reason it came out
-- of can_see_action: a consultant under contract should read their own scope.
drop policy if exists scope_access on public.project_scope_items;
create policy scope_access on public.project_scope_items
  for all
  using (
    public.is_project_member(project_id)
    and (not public.is_contract_bounded_member(project_id)
         or contract_id in (select contract_id from public.my_contract_ids(project_id))))
  with check (
    public.is_project_member(project_id)
    and (not public.is_contract_bounded_member(project_id)
         or contract_id in (select contract_id from public.my_contract_ids(project_id))));

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
