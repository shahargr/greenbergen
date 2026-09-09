-- 033 - a contractor can ask before they commit, and asking is not accepting.
--
-- Shahar, on the offer in the inbox: "once open, you should see the project,
-- accept as is, accept but asking for more details (price is not approved),
-- or archive (not interest)."
--
-- Two of those three already existed - homeowner_offer_accept and
-- homeowner_offer_decline. The middle one did not, and it is the one that
-- carries the whole idea: a contractor who wants the job but cannot stand
-- behind the community price until they know something. BUILD.md C9 has
-- called it "ask to connect" since the app was designed; Shahar's phrasing
-- says the same thing more plainly, and his parenthesis is the rule:
-- THE PRICE IS NOT APPROVED. This is not a bid, not an acceptance, and not
-- a counter-offer.
--
-- THE ADDRESS STAYS WITHHELD. That is the point of the whole address rule
-- (migration 008) and the easiest thing in the world to leak by accident:
-- asking a question must not seat anyone, must not touch bid_may_see_address,
-- and must not move the booking off 'posted'. This function writes ONE row -
-- an actions row for us to work - and touches nothing else. The bid stays
-- 'invited', so the offer is still open to everyone it went to and the
-- contractor who asked has given nothing up.
--
-- WHY AN ACTION AND NOT A MESSAGE. send_portal_message requires a shared
-- project, and the whole point is that this contractor is NOT on the project
-- yet. An actions row is how every other "someone needs a human" path in
-- this system works, and it puts the question where the work is picked up.
create or replace function public.homeowner_offer_ask(p_project uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  b public.project_bookings; pkg public.blueprint_packages;
  v_me uuid := public.my_contact_id(); v_who text; v_persona uuid; v_id uuid; v_open uuid;
  v_q text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.assert_own_hands();
  if v_me is null then return jsonb_build_object('ok', false, 'reason', 'Please sign in first.'); end if;
  if v_q is null then return jsonb_build_object('ok', false, 'reason', 'Write what you need to know.'); end if;

  select * into b from public.project_bookings where project_id = p_project;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such job.'); end if;
  if b.state <> 'posted' then
    return jsonb_build_object('ok', false, 'reason', 'That job is no longer open.');
  end if;

  -- You may only ask about an offer that was actually made to you.
  if not exists (select 1 from public.bids bd
                  where bd.package_id = b.bid_package_id and bd.bidder_contact_id = v_me
                    and bd.status in ('invited','received')) then
    return jsonb_build_object('ok', false, 'reason', 'That offer was not made to you.');
  end if;

  -- One open question per contractor per job: asking twice is one thread,
  -- not two tasks. The second one appends rather than piling up.
  --
  -- The contractor is the RAISER (assigned_by_contact_id), never the
  -- assignee - this is our work to answer, and chk_assigned_to_one_owner
  -- forbids a row that is assigned to both a persona and a contact anyway.
  select a.id into v_open from public.actions a
   where a.project_id = p_project and a.source = 'homeowner_app_offer_question'
     and a.assigned_by_contact_id = v_me
     and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
   limit 1;

  select * into pkg from public.blueprint_packages where code = b.package_code;
  select coalesce(c.person_name, c.name) into v_who from public.contacts c where c.id = v_me;
  select id into v_persona from public.personas where lower(name) = 'bobby' limit 1;

  if v_open is not null then
    update public.actions
       set notes = coalesce(notes, '') || E'\n\n' || to_char(now(), 'Mon DD HH24:MI') || E' - also:\n' || v_q,
           last_updated = now(), last_modified_by = 'homeowner-app:offer-question'
     where id = v_open;
    return jsonb_build_object('ok', true, 'action_id', v_open, 'appended', true);
  end if;

  -- assigned_by is a PERSONA name and nothing else: since v104 personas holds
  -- agents only, and a real person is recorded through assigned_by_contact_id.
  -- fn_actions_normalize_enums enforces it, which is how this was caught.
  insert into public.actions (action, domain, status, priority, project_id, source, created_by,
                              assigned_to, assigned_to_persona_id, assigned_by_contact_id,
                              depth_level, notes, desired_outcome)
  values ('Question before accepting: ' || coalesce(pkg.name, b.package_code) || ' - ' || coalesce(v_who, 'a contractor'),
          'construction', 'Not Started', 'High', p_project, 'homeowner_app_offer_question', 'homeowner-app',
          'Bobby', v_persona, v_me, 2,
          coalesce(v_who, 'A contractor') || ' wants the job but will not stand behind the community price until this is answered. '
          || 'THE PRICE IS NOT AGREED and the address has NOT been released - the offer is still open to everyone it went to.'
          || E'\n\nWhat they asked:\n' || v_q,
          'The contractor has their answer and either accepts at the community price or passes, so the job stops waiting.')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'action_id', v_id, 'appended', false);
end $$;

comment on function public.homeowner_offer_ask(uuid, text) is
  'A contractor asks a question about an offer before accepting it. NOT a bid, NOT an acceptance, NOT a counter-offer: the community price is not agreed, the bid stays invited, the booking stays posted, nobody is seated and the ADDRESS IS NOT RELEASED. Writes one actions row (source homeowner_app_offer_question) for a human to answer; a second question from the same contractor on the same job appends to it rather than opening another. BUILD.md C9.';

revoke all on function public.homeowner_offer_ask(uuid, text) from public, anon;
grant execute on function public.homeowner_offer_ask(uuid, text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
