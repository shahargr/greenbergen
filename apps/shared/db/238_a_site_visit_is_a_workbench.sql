-- 238 A SITE VISIT IS A WORKBENCH, NOT A NOTE.
--
-- Shahar (2026-09-25), on the Site visit tile that did nothing: "under site
-- visit, GC/PM should be able to: log tasks (simple ones, and assign to
-- traders working on site, self); see all activities by each trader working
-- on site; log a financial transaction, permit conversation, learning; view
-- each active trader's status; log bidding information (pricing, scope,
-- etc); log photos of today's visit; open tasks by trader; punch list by
-- trader."
--
-- Decided with him the same day:
--   * A punch item is a TASK of a new kind, 'punch' - filed under the
--     trade's "Punch list and inspection" step when there is one, closing
--     with a photo, so it is in the trade's open work like anything else.
--   * A permit conversation is a NOTE on the permits line (trade Utilities &
--     Municipalities, screen 'site-visit:permit'), with an optional follow-up
--     task - portal_note_add and portal_note_to_task already do both.
--   * Bidding information goes INTO THE BID ROOM: the trade's package is
--     opened or joined, the bidder added, and their number recorded - so it
--     compares and awards like any other bid.
--
-- What is new here: the kind, one read for the whole screen
-- (portal_site_visit_board), and three writes (portal_punch_add,
-- portal_learning_add, portal_site_bid_log). The simple task, the payment,
-- the photos and the note all reuse what exists.

-- ── THE KIND ────────────────────────────────────────────────────────────────
insert into public.task_kinds
  (kind, label, sentence, hint, asks, action_type, delivers, requires_photo,
   closes_with, follow_kind, default_priority, sort_order, is_active)
values
  ('punch', 'Punch', 'Fix it before it counts as done',
   'Something a trade still owes before their work is finished. One line, whose it is, a photo of it. Closes with a photo of it fixed.',
   array['what','trade','who','when'], 'visual inspection', 'work', true,
   'photo', null, 'Medium', 15, true)
on conflict (kind) do nothing;

-- ── ONE READ FOR THE SCREEN ─────────────────────────────────────────────────
-- Everything the site-visit screen shows that the trade spine
-- (portal_project_trades) and the visit log (portal_site_visits) do not:
-- who is here today, who works each trade, every open task by trade with
-- its kind, the week's activity, the permit line, learnings, what needs an
-- eye, and the bid rooms still waiting.
create or replace function public.portal_site_visit_board(p_project uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_me    uuid;
  v_out   jsonb;
begin
  if not public.is_project_member(p_project) and not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'You are not on this project.');
  end if;
  select u.contact_id into v_me from public.app_users u where u.id = public.current_app_user_id();

  with fam as (select d.id from public.project_ancestry_down(p_project) d),
  open_t as (
    select a.id, a.action, a.status, a.target_date, a.is_gate, a.kind, a.action_type,
           a.project_id, a.assigned_to_contact_id,
           coalesce(a.trade, par.trade) as trade,
           coalesce(c.person_name, c.name, pe.name) as assignee
      from public.actions a
      left join public.actions par on par.id = a.parent_action_id
      left join public.contacts c on c.id = a.assigned_to_contact_id
      left join public.personas pe on pe.id = a.assigned_to_persona_id
     where a.project_id in (select id from fam)
       and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
       and public.can_see_action(a.id)
  ),
  roster as (
    select distinct r.contact_id, coalesce(c.person_name, c.name) as name
      from public.site_roster r
      join public.contacts c on c.id = r.contact_id
     where r.project_id in (select id from fam) and r.on_date = v_today
  ),
  -- WHO WORKS EACH TRADE HERE: whoever holds its open work, whoever it is
  -- contracted to, and whoever is on today's roster with that trade.
  people as (
    select distinct o.assigned_to_contact_id as contact_id, o.trade
      from open_t o where o.assigned_to_contact_id is not null and o.trade is not null
    union
    select distinct ct.counterparty_contact_id, ct.trade
      from public.contracts ct
     where ct.project_id in (select id from fam) and ct.trade is not null
       and ct.counterparty_contact_id is not null and ct.status <> 'placeholder'
    union
    select distinct r.contact_id, tr.trade
      from roster r join public.contact_trade_roles tr on tr.contact_id = r.contact_id
  )
  select jsonb_build_object(
    'ok', true,
    'today', v_today,
    'me', v_me,
    -- Where work lands when nothing more specific says: the busiest job
    -- beneath that takes tasks (a property holds none of its own).
    'default_job', (select o.project_id from open_t o
                     where public.portal_task_takes_tasks(o.project_id)
                     group by o.project_id order by count(*) desc limit 1),
    -- The job each trade's open punch-list step sits on, so a photo for a
    -- punch item is uploaded to the job the item will land on.
    'punch_on', coalesce((select jsonb_object_agg(x.trade, x.project_id) from (
        select distinct on (coalesce(s.trade, b.trade)) coalesce(s.trade, b.trade) as trade, s.project_id
          from public.actions s left join public.actions b on b.id = s.parent_action_id
         where s.project_id in (select id from fam) and s.action ilike 'Punch list%'
           and coalesce(s.trade, b.trade) is not null
           and s.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
           and coalesce(s.accepts_steps, true)
         order by coalesce(s.trade, b.trade), s.created_at) x), '{}'::jsonb),
    'roster', coalesce((select jsonb_agg(jsonb_build_object(
        'contact_id', r.contact_id, 'name', r.name,
        'trades', coalesce((select jsonb_agg(tr.trade order by tr.trade)
                              from public.contact_trade_roles tr where tr.contact_id = r.contact_id), '[]'::jsonb))
        order by r.name) from roster r), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object(
        'contact_id', p.contact_id, 'trade', p.trade,
        'name', coalesce(c.person_name, c.name),
        'on_site', exists (select 1 from roster r where r.contact_id = p.contact_id))
        order by p.trade, coalesce(c.person_name, c.name))
        from people p join public.contacts c on c.id = p.contact_id
       where c.disabled_at is null), '[]'::jsonb),
    'open', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'action', o.action, 'status', o.status, 'target_date', o.target_date,
        'is_gate', o.is_gate, 'kind', o.kind, 'trade', o.trade, 'project_id', o.project_id,
        'assignee', o.assignee, 'assignee_id', o.assigned_to_contact_id)
        order by o.target_date nulls last, o.action)
        from (select * from open_t limit 600) o), '[]'::jsonb),
    -- THE WEEK, AS IT HAPPENED: finished, started, said, and who turned up.
    'activity', coalesce((select jsonb_agg(x.j order by x.at desc) from (
        select a.completed_on::timestamptz as at, jsonb_build_object(
                 'at', a.completed_on, 'what', 'done', 'text', a.action, 'id', a.id,
                 'trade', coalesce(a.trade, par.trade),
                 'who', coalesce(c.person_name, c.name)) as j
          from public.actions a
          left join public.actions par on par.id = a.parent_action_id
          left join public.contacts c on c.id = a.assigned_to_contact_id
         where a.project_id in (select id from fam) and a.status = 'Completed'
           and a.completed_on >= v_today - 7 and public.can_see_action(a.id)
        union all
        select a.created_at, jsonb_build_object(
                 'at', a.created_at, 'what', 'new', 'text', a.action, 'id', a.id,
                 'trade', coalesce(a.trade, par.trade),
                 'who', coalesce(c.person_name, c.name))
          from public.actions a
          left join public.actions par on par.id = a.parent_action_id
          left join public.contacts c on c.id = a.assigned_to_contact_id
         where a.project_id in (select id from fam)
           and a.created_at >= (v_today - 7)::timestamptz and public.can_see_action(a.id)
        union all
        select n.created_at, jsonb_build_object(
                 'at', n.created_at, 'what', case when n.screen = 'site-visit:permit' then 'permit' else 'note' end,
                 'text', n.body, 'id', n.id, 'trade', n.trade,
                 'who', coalesce(u.full_name, u.email))
          from public.notes n left join public.app_users u on u.id = n.app_user_id
         where n.project_id in (select id from fam) and n.archived_at is null
           and n.created_at >= (v_today - 7)::timestamptz
           and (n.app_user_id = public.current_app_user_id() or n.screen like 'site-visit:%')
        union all
        select min(ci.created_at), jsonb_build_object(
                 'at', min(ci.created_at), 'what', 'on_site', 'text', 'On site',
                 'id', l.contact_id,
                 'trade', (select tr.trade from public.contact_trade_roles tr where tr.contact_id = l.contact_id order by tr.trade limit 1),
                 'who', coalesce(c.person_name, c.name))
          from public.site_checkins ci
          join public.site_checkin_links l on l.token = ci.link_token
          left join public.contacts c on c.id = l.contact_id
         where l.project_id in (select id from fam) and ci.created_at >= (v_today - 7)::timestamptz
         group by l.contact_id, c.person_name, c.name, (ci.created_at at time zone 'America/New_York')::date
        order by 1 desc limit 80) x), '[]'::jsonb),
    'permits', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'at', n.created_at, 'body', n.body, 'became', n.became_action_id,
        'who', coalesce(u.full_name, u.email)) order by n.created_at desc)
        from (select * from public.notes n0
               where n0.project_id in (select id from fam) and n0.screen = 'site-visit:permit'
               order by n0.created_at desc limit 8) n
        left join public.app_users u on u.id = n.app_user_id), '[]'::jsonb),
    'learnings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'title', l.title, 'detail', l.detail, 'trade', l.trade,
        'checklist', l.add_to_checklist, 'at', l.created_at) order by l.created_at desc)
        from (select * from public.learnings l0 where l0.project_id in (select id from fam)
               order by l0.created_at desc limit 8) l), '[]'::jsonb),
    -- WHAT NEEDS AN EYE WHILE YOU ARE STANDING THERE.
    'watch', jsonb_build_object(
      'late', (select count(*) from open_t o where o.target_date < v_today),
      'inspections', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'action', o.action,
          'trade', o.trade, 'target_date', o.target_date) order by o.target_date)
          from open_t o where (o.kind = 'check' or (o.action_type = 'visual inspection' and coalesce(o.kind, '') <> 'punch'))
           and o.target_date <= v_today + 7), '[]'::jsonb),
      'deliveries', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'action', o.action,
          'trade', o.trade, 'target_date', o.target_date) order by o.target_date)
          from open_t o where (o.kind = 'deliver' or o.action_type = 'delivery')
           and o.target_date <= v_today + 2), '[]'::jsonb),
      'approve', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'action', o.action,
          'trade', o.trade, 'who', o.assignee) order by o.action)
          from open_t o where o.status = 'Completed Pending Approval'), '[]'::jsonb),
      'waiting', (select count(*) from open_t o where o.status = 'Pending on Others'),
      'gates', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'action', o.action,
          'trade', o.trade, 'target_date', o.target_date) order by o.target_date nulls last)
          from open_t o where o.is_gate), '[]'::jsonb)),
    'bids', coalesce((select jsonb_agg(jsonb_build_object(
        'id', bp.id, 'project_id', bp.project_id, 'trade', bp.trade, 'reply_by', bp.reply_by,
        'in_room', (select count(*) from public.bids b where b.package_id = bp.id),
        'priced', (select count(*) from public.bids b where b.package_id = bp.id and b.amount is not null),
        'low', case when public.bid_can_manage(bp.project_id)
                    then (select min(b.amount) from public.bids b where b.package_id = bp.id) end)
        order by bp.reply_by nulls last)
        from public.bid_packages bp
       where bp.project_id in (select id from fam)
         and coalesce(bp.status, '') not in ('closed', 'awarded') and bp.awarded_bid_id is null), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $function$;

-- ── A PUNCH ITEM ────────────────────────────────────────────────────────────
-- Lands under the trade's open "Punch list and inspection" step when the
-- family has one (the step itself carries no trade - its build does), else
-- on the job the caller names, else on this project if it takes tasks.
create or replace function public.portal_punch_add(
  p_project uuid, p_trade text, p_what text,
  p_assignee uuid default null, p_target_date date default null,
  p_file_ids uuid[] default null, p_job uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_trade text; v_step uuid; v_job uuid; r jsonb; v_id uuid;
begin
  perform public.assert_own_hands();
  if not public.is_project_member(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'You are not on this project.');
  end if;
  select t.trade into v_trade from public.trades t where lower(t.trade) = lower(btrim(coalesce(p_trade, '')));
  if v_trade is null then
    return jsonb_build_object('ok', false, 'reason', 'A punch item belongs to a trade - whose is it?');
  end if;

  select s.id, s.project_id into v_step, v_job
    from public.actions s
    left join public.actions b on b.id = s.parent_action_id
   where s.project_id in (select d.id from public.project_ancestry_down(p_project) d)
     and s.action ilike 'Punch list%'
     and coalesce(s.trade, b.trade) = v_trade
     and s.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
     and coalesce(s.accepts_steps, true)
   order by s.created_at limit 1;

  if v_step is null then
    v_job := case
      when p_job is not null and p_job in (select d.id from public.project_ancestry_down(p_project) d)
           and public.portal_task_takes_tasks(p_job) then p_job
      when public.portal_task_takes_tasks(p_project) then p_project end;
    if v_job is null then
      return jsonb_build_object('ok', false, 'code', 'IS_PROPERTY',
        'reason', format('Nothing on %s has a job to hang a punch list on yet. Start the trade first.', v_trade));
    end if;
  end if;

  -- Refused before anything is written: portal_task_create would insert the
  -- task and only then turn away a file from another job.
  if exists (select 1 from unnest(coalesce(p_file_ids, '{}'::uuid[])) f
              where not exists (select 1 from public.files x where x.id = f and x.project_id = v_job)) then
    return jsonb_build_object('ok', false, 'code', 'FILE_ELSEWHERE',
      'reason', 'That photo was filed on a different job. Attach it again and it will land in the right place.');
  end if;

  r := public.portal_task_create(
    p_project => v_job, p_action => p_what, p_type => 'visual inspection', p_delivers => 'work',
    p_priority => 'Medium', p_target_date => p_target_date, p_assignee => p_assignee,
    p_parent => v_step, p_file_ids => p_file_ids,
    p_trade => case when v_step is null then v_trade end,
    p_requires_photo => true);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;

  v_id := (r->>'id')::uuid;
  update public.actions set kind = 'punch', accepts_steps = false,
         trade = coalesce(trade, v_trade), source = 'portal:site-visit'
   where id = v_id;
  return r || jsonb_build_object('trade', v_trade, 'under_step', v_step is not null, 'project_id', v_job);
end $function$;

-- ── A LEARNING ──────────────────────────────────────────────────────────────
-- Institutional knowledge (help: learnings), so the table itself is
-- superadmin-only; whoever runs this job may add one from it.
create or replace function public.portal_learning_add(
  p_project uuid, p_title text, p_detail text default null,
  p_trade text default null, p_checklist boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_trade text; v_id uuid; v_who text;
begin
  perform public.assert_own_hands();
  if not (public.bid_can_manage(p_project) or public.can_edit_project(p_project)) then
    return jsonb_build_object('ok', false, 'reason', 'Recording a learning on this job is not yours to do.');
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'Say what was learned, in a line.');
  end if;
  if nullif(btrim(coalesce(p_trade, '')), '') is not null then
    select t.trade into v_trade from public.trades t where lower(t.trade) = lower(btrim(p_trade));
  end if;
  select coalesce(u.full_name, u.email) into v_who from public.app_users u where u.id = public.current_app_user_id();

  insert into public.learnings (title, detail, project_id, trade, add_to_checklist, created_by, last_modified_by)
  values (left(btrim(p_title), 300), nullif(btrim(coalesce(p_detail, '')), ''), p_project, v_trade,
          coalesce(p_checklist, true), coalesce(v_who, 'portal:site-visit'), 'portal:site-visit')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'trade', v_trade);
end $function$;

-- ── A PRICE HEARD ON SITE ───────────────────────────────────────────────────
-- Into the trade's bid room on the job: open or join the room, add the
-- bidder, record the number and the scope as said.
create or replace function public.portal_site_bid_log(
  p_job uuid, p_trade text,
  p_contact uuid default null, p_company_name text default null,
  p_person_name text default null, p_phone text default null,
  p_amount numeric default null, p_scope text default null, p_valid_until date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r jsonb; v_pkg uuid; v_bid uuid; b public.bids; v_who text; v_line text;
begin
  perform public.assert_own_hands();
  if p_amount is not null and p_amount < 0 then
    return jsonb_build_object('ok', false, 'reason', 'A price is a positive number.');
  end if;
  if p_amount is null and nullif(btrim(coalesce(p_scope, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'Give a number, or what they said about the scope.');
  end if;

  r := public.portal_bid_room_open(p_project => p_job, p_trade => p_trade);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  v_pkg := (r->>'id')::uuid;

  r := public.portal_bid_room_add(p_package => v_pkg, p_contact => p_contact,
         p_company_name => p_company_name, p_person_name => p_person_name, p_phone => p_phone);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  v_bid := (r->>'id')::uuid;

  select * into b from public.bids where id = v_bid;
  if b.status in ('awarded', 'not awarded', 'withdrawn', 'declined') then
    return jsonb_build_object('ok', false, 'reason', 'Their bid on this is already settled.');
  end if;

  select coalesce(u.full_name, u.email) into v_who from public.app_users u where u.id = public.current_app_user_id();
  v_line := 'ON SITE (' || to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD')
            || ', ' || coalesce(v_who, 'portal') || ')'
            || coalesce(': $' || round(p_amount)::text, '')
            || coalesce(' - ' || nullif(btrim(p_scope), ''), '');

  if b.status = 'under negotiation' and p_amount is not null then
    r := public.portal_bid_negotiate(v_bid, p_amount, p_scope);
    if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  else
    update public.bids
       set amount = coalesce(p_amount, amount),
           status = case when coalesce(p_amount, amount) is not null
                          and status in ('invited', 'no response', 'expired') then 'received' else status end,
           received_on = case when p_amount is not null then coalesce(received_on, current_date) else received_on end,
           valid_until = coalesce(p_valid_until, valid_until),
           scope_summary = coalesce(scope_summary, nullif(btrim(p_scope), '')),
           notes = coalesce(notes || E'\n\n', '') || v_line,
           last_modified_at = now(), last_modified_by = 'portal:site-visit'
     where id = v_bid;
  end if;

  return jsonb_build_object('ok', true, 'package_id', v_pkg, 'bid_id', v_bid,
    'who', r->>'who', 'amount', coalesce(p_amount, b.amount));
end $function$;

revoke all on function public.portal_site_visit_board(uuid) from public, anon;
revoke all on function public.portal_punch_add(uuid, text, text, uuid, date, uuid[], uuid) from public, anon;
revoke all on function public.portal_learning_add(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.portal_site_bid_log(uuid, text, uuid, text, text, text, numeric, text, date) from public, anon;
grant execute on function public.portal_site_visit_board(uuid) to authenticated, service_role;
grant execute on function public.portal_punch_add(uuid, text, text, uuid, date, uuid[], uuid) to authenticated, service_role;
grant execute on function public.portal_learning_add(uuid, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.portal_site_bid_log(uuid, text, uuid, text, text, text, numeric, text, date) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
