-- 034 - the other half of C9: the homeowner decides, and a thread opens.
--
-- Migration 033 gave a contractor a way to ask before accepting. It parked
-- the question with US, which was the easy half and the wrong owner:
-- BUILD.md C9 has always said the HOMEOWNER approves or declines, and they
-- are the only one who knows how far the meter is from the pad. So the
-- question is re-addressed to them here, and this migration builds what
-- happens next.
--
-- THE SHAPE
--
--   asked      actions row, Not Started, assigned to the homeowner
--   approved   -> In Progress. A thread opens: messages rows carrying
--                 action_id, between exactly two contacts.
--   declined   -> Cancelled. One message says so. No thread.
--   answered   -> Completed, by either side, when it has served its purpose.
--
-- WHAT THIS IS NOT, and the reason the whole thing is narrow:
--
-- 1. THE ADDRESS STAYS WITHHELD. Approving a thread does not seat anyone and
--    does not satisfy bid_may_see_address. A homeowner who types their
--    address into the thread has chosen to; the SYSTEM never releases it
--    before the award, and the screens say so on both sides.
-- 2. IT IS NOT A PRICE NEGOTIATION. The community price is the community
--    price; a contractor accepts it or passes. The thread exists so a
--    question can be answered, not so a number can be moved.
-- 3. IT IS NOT A GENERAL BACK CHANNEL. send_portal_message still requires a
--    shared project and is untouched. This thread reaches exactly one person
--    about exactly one question, is bounded to that action row, and dies
--    with it.
-- 4. GREEN BERGEN SEES IT. Superadmin reads everything already; these
--    threads are the raw material for the next version of the catalogue.
--
-- WHY MESSAGES AND NOT A NEW TABLE (rulebook 30): messages already carries
-- action_id, from/to contacts, read_at and the inbox that renders it.
-- portal_my_messages returns a message to whoever it is addressed to without
-- asking about project membership, so the contractor sees the answer in the
-- inbox they already have, unseated, with no new read to build.

-- ---------------------------------------------------------------------
-- 1. The question goes to the homeowner.
-- ---------------------------------------------------------------------
create or replace function public.homeowner_offer_ask(p_project uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  b public.project_bookings; pkg public.blueprint_packages;
  v_me uuid := public.my_contact_id(); v_who text; v_owner uuid; v_id uuid; v_open uuid;
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

  if not exists (select 1 from public.bids bd
                  where bd.package_id = b.bid_package_id and bd.bidder_contact_id = v_me
                    and bd.status in ('invited','received')) then
    return jsonb_build_object('ok', false, 'reason', 'That offer was not made to you.');
  end if;

  -- One open question per contractor per job.
  select a.id into v_open from public.actions a
   where a.project_id = p_project and a.source = 'homeowner_app_offer_question'
     and a.assigned_by_contact_id = v_me
     and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
   limit 1;

  select * into pkg from public.blueprint_packages where code = b.package_code;
  select coalesce(c.person_name, c.name) into v_who from public.contacts c where c.id = v_me;
  -- The person who has to answer it. Not us: they are the only one who knows.
  select u.contact_id into v_owner
    from public.projects p join public.app_users u on u.id = p.owner_user_id
   where p.id = p_project;

  if v_open is not null then
    update public.actions
       set notes = coalesce(notes, '') || E'\n\n' || to_char(now(), 'Mon DD HH24:MI') || E' - also:\n' || v_q,
           last_updated = now(), last_modified_by = 'homeowner-app:offer-question'
     where id = v_open;
    return jsonb_build_object('ok', true, 'action_id', v_open, 'appended', true);
  end if;

  -- assigned_by is a PERSONA name and nothing else: since v104 personas holds
  -- agents only, and a real person is recorded through assigned_by_contact_id.
  insert into public.actions (action, domain, status, priority, project_id, source, created_by,
                              assigned_to_contact_id, assigned_by_contact_id,
                              depth_level, notes, desired_outcome)
  values ('Question before accepting: ' || coalesce(pkg.name, b.package_code) || ' - ' || coalesce(v_who, 'a contractor'),
          'construction', 'Not Started', 'High', p_project, 'homeowner_app_offer_question', 'homeowner-app',
          v_owner, v_me, 2,
          coalesce(v_who, 'A contractor') || ' wants the job but will not stand behind the community price until this is answered. '
          || 'THE PRICE IS NOT AGREED and the address has NOT been released - the offer is still open to everyone it went to.'
          || E'\n\nWhat they asked:\n' || v_q,
          'The contractor has their answer and either accepts at the community price or passes, so the job stops waiting.')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'action_id', v_id, 'appended', false);
end $$;

comment on function public.homeowner_offer_ask(uuid, text) is
  'A contractor asks a question about an offer before accepting it. NOT a bid, NOT an acceptance, NOT a counter-offer: the community price is not agreed, the bid stays invited, the booking stays posted, nobody is seated and the ADDRESS IS NOT RELEASED. Writes one actions row (source homeowner_app_offer_question) addressed to the HOMEOWNER, who approves or declines it with homeowner_offer_question_respond. A second question from the same contractor on the same job appends rather than opening another. BUILD.md C9.';

revoke all on function public.homeowner_offer_ask(uuid, text) from public, anon;
grant execute on function public.homeowner_offer_ask(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. What is waiting on me, whichever side I am.
-- ---------------------------------------------------------------------
-- One function, two readings: the homeowner sees questions to answer, the
-- contractor sees questions they asked and how they went. Two lists built
-- from the same rows would be two chances to disagree.
create or replace function public.homeowner_offer_questions()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
-- No `me` CTE in the FROM list: a JOIN written after a comma-join binds to
-- the LAST item, so `join projects p on p.id = a.project_id` could not see
-- `a` at all. portal_my_work carries a comment about exactly this trap and
-- it caught me anyway. my_contact_id() is stable; calling it inline is one
-- evaluation and no join.
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'action_id', a.id,
    'project_id', a.project_id,
    'package', coalesce(bp.name, b.package_code),
    'status', a.status,
    'state', case when a.status in ('Cancelled','Force Cancelled') then 'declined'
                  when a.status = 'Completed' then 'closed'
                  when a.status = 'Not Started' then 'asked'
                  else 'open' end,
    'mine', (a.assigned_by_contact_id = public.my_contact_id()),
    'asked_by', (select coalesce(c.person_name, c.name) from public.contacts c where c.id = a.assigned_by_contact_id),
    'asked_at', a.created_at,
    'question', a.notes,
    'town', nullif(btrim(split_part(p.address, ',', 2)), ''),
    'replies', (select count(*) from public.messages m where m.action_id = a.id),
    'unread', (select count(*) from public.messages m
                where m.action_id = a.id and m.to_contact_id = public.my_contact_id() and m.read_at is null)
  ) order by a.created_at desc), '[]'::jsonb)
  from public.actions a
  join public.projects p on p.id = a.project_id
  left join public.project_bookings b on b.project_id = a.project_id
  left join public.blueprint_packages bp on bp.code = b.package_code
  where a.source = 'homeowner_app_offer_question'
    and public.my_contact_id() in (a.assigned_to_contact_id, a.assigned_by_contact_id);
$$;

comment on function public.homeowner_offer_questions() is
  'Every offer question you are a party to, from whichever side: `mine` true means you asked it, false means it is yours to answer. state: asked (waiting on the homeowner) | open (a thread is running) | declined | closed.';

revoke all on function public.homeowner_offer_questions() from public, anon;
grant execute on function public.homeowner_offer_questions() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. The homeowner approves or declines.
-- ---------------------------------------------------------------------
create or replace function public.homeowner_offer_question_respond(p_action uuid, p_approve boolean, p_reply text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare a public.actions; v_me uuid := public.my_contact_id(); v_body text := nullif(btrim(coalesce(p_reply,'')), '');
begin
  perform public.assert_own_hands();
  if v_me is null then return jsonb_build_object('ok', false, 'reason', 'Please sign in first.'); end if;

  select * into a from public.actions where id = p_action and source = 'homeowner_app_offer_question';
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'No such question.'); end if;
  -- Only the person it was addressed to may answer it. Not the contractor
  -- who asked, and not a bystander on the project.
  if a.assigned_to_contact_id is distinct from v_me and not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'That question is not yours to answer.');
  end if;
  if a.status in ('Completed','Cancelled','Force Cancelled','Superseded') then
    return jsonb_build_object('ok', false, 'reason', 'That question is already settled.');
  end if;
  if p_approve and v_body is null then
    return jsonb_build_object('ok', false, 'reason', 'Write your answer.');
  end if;

  update public.actions
     set status = case when p_approve then 'In Progress' else 'Cancelled' end,
         last_updated = now(), last_modified_by = 'homeowner-app:offer-question',
         notes = coalesce(notes, '') || E'\n\n' || to_char(now(), 'Mon DD HH24:MI')
                 || case when p_approve then ' - answered by the homeowner.' else ' - declined by the homeowner.' end
   where id = a.id;

  -- The reply IS the thread opener. A decline still sends one message: the
  -- contractor asked a question and deserves an answer, even when the answer
  -- is "not before you accept".
  insert into public.messages (body, direction, channel, status, sent_at,
                               project_id, from_contact_id, to_contact_id, action_id, created_by)
  values (coalesce(v_body, 'Not before someone accepts — the details come with the job.'),
          'inbound', 'in app', 'new', now(),
          a.project_id, v_me, a.assigned_by_contact_id, a.id, 'homeowner-app:offer-question')
  ;

  return jsonb_build_object('ok', true, 'approved', p_approve);
end $$;

comment on function public.homeowner_offer_question_respond(uuid, boolean, text) is
  'The homeowner answers a contractor''s pre-acceptance question. Approve opens a private thread (messages carrying the question''s action_id); decline closes it with one final message. NEITHER seats the contractor, moves the booking, touches the bid or releases the address - the community price and the address rule are exactly where they were.';

revoke all on function public.homeowner_offer_question_respond(uuid, boolean, text) from public, anon;
grant execute on function public.homeowner_offer_question_respond(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. The thread: read it, and write into it.
-- ---------------------------------------------------------------------
create or replace function public.homeowner_offer_thread(p_action uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare a public.actions; v_me uuid := public.my_contact_id();
begin
  select * into a from public.actions where id = p_action and source = 'homeowner_app_offer_question';
  if a.id is null then return null; end if;
  if v_me is null then return null; end if;
  if v_me not in (a.assigned_to_contact_id, a.assigned_by_contact_id) and not public.is_superadmin() then
    return null;
  end if;

  return jsonb_build_object(
    'action_id', a.id,
    'project_id', a.project_id,
    'status', a.status,
    'open', a.status = 'In Progress',
    'i_asked', (a.assigned_by_contact_id = v_me),
    'with', (select coalesce(c.person_name, c.name) from public.contacts c
              where c.id = case when a.assigned_by_contact_id = v_me
                                then a.assigned_to_contact_id else a.assigned_by_contact_id end),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'body', m.body, 'sent_at', m.sent_at,
        'mine', (m.from_contact_id = v_me),
        'who', (select coalesce(c.person_name, c.name) from public.contacts c where c.id = m.from_contact_id))
        order by m.sent_at)
      from public.messages m where m.action_id = a.id), '[]'::jsonb));
end $$;

comment on function public.homeowner_offer_thread(uuid) is
  'One pre-acceptance question and everything said about it, for either party (or a superadmin). Null when it is not yours.';

revoke all on function public.homeowner_offer_thread(uuid) from public, anon;
grant execute on function public.homeowner_offer_thread(uuid) to authenticated, service_role;

create or replace function public.homeowner_offer_thread_send(p_action uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare a public.actions; v_me uuid := public.my_contact_id(); v_to uuid;
        v_body text := nullif(btrim(coalesce(p_body,'')), '');
begin
  perform public.assert_own_hands();
  if v_me is null then return jsonb_build_object('ok', false, 'reason', 'Please sign in first.'); end if;
  if v_body is null then return jsonb_build_object('ok', false, 'reason', 'Write something first.'); end if;

  select * into a from public.actions where id = p_action and source = 'homeowner_app_offer_question';
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'No such question.'); end if;
  -- A thread exists only while the question is open. Declined or closed, it
  -- is a record, not a channel - which is what keeps this from quietly
  -- becoming general messaging between two people who share no project.
  if a.status <> 'In Progress' then
    return jsonb_build_object('ok', false, 'reason', 'That thread is closed.');
  end if;
  if v_me not in (a.assigned_to_contact_id, a.assigned_by_contact_id) then
    return jsonb_build_object('ok', false, 'reason', 'That thread is not yours.');
  end if;
  v_to := case when v_me = a.assigned_by_contact_id then a.assigned_to_contact_id else a.assigned_by_contact_id end;

  insert into public.messages (body, direction, channel, status, sent_at,
                               project_id, from_contact_id, to_contact_id, action_id, created_by)
  values (v_body, 'inbound', 'in app', 'new', now(),
          a.project_id, v_me, v_to, a.id, 'homeowner-app:offer-question');

  update public.actions set last_updated = now(), last_modified_by = 'homeowner-app:offer-question' where id = a.id;
  return jsonb_build_object('ok', true);
end $$;

comment on function public.homeowner_offer_thread_send(uuid, text) is
  'Write into an open pre-acceptance thread. Either party, while the question is In Progress; closed or declined, nobody. Deliberately NOT send_portal_message, which requires a shared project and stays that way - this reaches exactly one person about exactly one question and dies with it.';

revoke all on function public.homeowner_offer_thread_send(uuid, text) from public, anon;
grant execute on function public.homeowner_offer_thread_send(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. RLS agrees with the function.
-- ---------------------------------------------------------------------
-- portal_my_messages (SECURITY DEFINER) returns a directed message to whoever
-- it is addressed to without asking about project membership, so the inbox
-- already works. can_see_file's sibling for messages did NOT: a direct table
-- read required is_project_member, and the contractor is deliberately not a
-- member. Two answers about one row is the bug; this is the branch that
-- makes them agree, and it is as narrow as the thread it serves.
create or replace function public.can_see_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.messages m
     where m.id = p_message_id
       and (
         (public.is_project_member(m.project_id)
          and (
            not public.is_contract_bounded_member(m.project_id)
            or m.from_contact_id = public.my_contact_id()
            or m.to_contact_id   = public.my_contact_id()
            or (m.action_id is not null and public.can_see_action(m.action_id))
            or (m.contractor_id is not null and m.contractor_id in (
                  select contact_id from public.my_team_contact_ids(m.project_id)))
          ))
         -- A pre-acceptance thread (BUILD.md C9, migration 034): its two
         -- parties, neither of whom need be on the project. Bounded to the
         -- question's own action row and to being named on the message.
         or (m.action_id is not null
             and public.my_contact_id() in (m.from_contact_id, m.to_contact_id)
             and exists (select 1 from public.actions a
                          where a.id = m.action_id
                            and a.source = 'homeowner_app_offer_question'
                            and public.my_contact_id() in (a.assigned_to_contact_id, a.assigned_by_contact_id)))
       )
  )
$$;

comment on function public.can_see_message(uuid) is
  'Who may read a message row directly. Project members under the contract-bounded rules, plus the two parties to a pre-acceptance offer question (migration 034), who share no project by design. Kept in step with portal_my_messages, which answers the same question for the inbox.';

revoke all on function public.can_see_message(uuid) from public, anon;
grant execute on function public.can_see_message(uuid) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
