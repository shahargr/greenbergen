-- 068 - a site visit is a record you can edit, and a week has trades on it.
--
-- Shahar (2026-09-11), on the Professionals project screen:
--   a. remove the toggle i'm on site / leaving.
--   b. log a site visit / allow to add voice / text / files-image. after
--      logged show the line, and allow to edit it / delete it.
--   c. show a panel for every trade working on site this week, allowing to
--      click on it and drill down to its tasks / payments / etc
--
-- (a) and (b) are the same change. The arrive/leave pair answers "are you on
-- site right this minute", and it costs two taps hours apart to answer it -
-- four check-ins exist in the whole database. What a site visit is actually
-- FOR is the record: I was there on Tuesday, here is what I saw, here is the
-- photo. So a visit becomes ONE entry with a note and whatever you attached,
-- and like every other record here it can be corrected or removed. The four
-- rows already written stay exactly as they are.
--
-- It is not a new table. site_checkins already holds a visit to a site, and
-- file_links.site_checkin_id already exists to hang files off one - the
-- machinery was there and only the arrive/leave shape was wrong. So 'visit'
-- joins the kinds, and the link-token check-in flow a crew uses without a
-- login (checkin_submit) is untouched.
alter table public.site_checkins drop constraint if exists site_checkins_kind_check;
alter table public.site_checkins add constraint site_checkins_kind_check
  check (kind in ('arrive', 'leave', 'visit'));

-- ---------------------------------------------------------------------------
-- LOG ONE. The note, the files, and the day it happened - which defaults to
-- today but is yours to set, because the visit you are writing up on Friday
-- evening happened on Friday morning.
create or replace function public.portal_site_visit_log(
  p_project uuid, p_note text default null, p_file_ids uuid[] default null, p_on date default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me       uuid := public.current_app_user_id();
  v_contact uuid; v_token uuid; v_id uuid; v_day date; f uuid; n int := 0;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;
  select u.contact_id into v_contact from public.app_users u where u.id = me;
  if v_contact is null then return jsonb_build_object('ok', false, 'reason', 'Your account has no contact record yet.'); end if;
  if not public.is_project_member(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'You are not on this project.');
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project
                  and nullif(btrim(coalesce(p.address, '')), '') is not null) then
    return jsonb_build_object('ok', false, 'reason', 'This project has no site to visit - log it on the property or the job.');
  end if;

  select count(*) into n from unnest(coalesce(p_file_ids, '{}'::uuid[])) x;
  if nullif(btrim(coalesce(p_note, '')), '') is null and n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'Say what you saw, or attach something. An empty visit records nothing.');
  end if;

  v_day := coalesce(p_on, (now() at time zone 'America/New_York')::date);
  if v_day > (now() at time zone 'America/New_York')::date then
    return jsonb_build_object('ok', false, 'reason', 'That day has not happened yet.');
  end if;

  v_token := public.portal_my_checkin_token(p_project);
  insert into public.site_checkins (link_token, kind, note, created_at)
  values (v_token, 'visit', nullif(btrim(p_note), ''),
          -- The day is what matters; the clock only orders the entries.
          case when v_day = (now() at time zone 'America/New_York')::date then now()
               else (v_day + time '12:00') at time zone 'America/New_York' end)
  returning id into v_id;

  -- Whoever was there is on that day's roster. That is the whole reason the
  -- roster exists, and it is what feeds the week panel below.
  insert into public.site_roster (project_id, on_date, contact_id, marked_by_user_id)
  values (p_project, v_day, v_contact, me)
  on conflict (project_id, on_date, contact_id) do nothing;

  -- The files keep their project link - a photo of the work is a photo of
  -- the project - and gain the visit as well, so the entry can show them.
  if p_file_ids is not null then
    foreach f in array p_file_ids loop
      if not exists (select 1 from public.files x where x.id = f and x.project_id = p_project) then
        return jsonb_build_object('ok', false, 'reason', 'One of those files does not belong to this project.');
      end if;
      update public.file_links set site_checkin_id = v_id where file_id = f and project_id = p_project;
      if not found then
        insert into public.file_links (file_id, project_id, site_checkin_id, role, created_by_user_id)
        values (f, p_project, v_id, 'progress', me);
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'on_date', v_day);
end $$;

-- ---------------------------------------------------------------------------
-- CORRECT ONE. Yours, or anyone's if you run the site. The note is replaced;
-- files are added, because removing a photo is removing a file and that
-- belongs to the file, not to the sentence beside it.
create or replace function public.portal_site_visit_edit(
  p_id uuid, p_note text default null, p_file_ids uuid[] default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id();
  v_contact uuid; v_project uuid; v_owner uuid; f uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;
  select u.contact_id into v_contact from public.app_users u where u.id = me;

  select l.project_id, l.contact_id into v_project, v_owner
    from public.site_checkins ci join public.site_checkin_links l on l.token = ci.link_token
   where ci.id = p_id and ci.kind = 'visit';
  if v_project is null then return jsonb_build_object('ok', false, 'reason', 'No such visit.'); end if;
  if not (v_owner = v_contact or public.is_superadmin()
          or coalesce(public.my_authority_rank(v_project), 0) >= 50) then
    return jsonb_build_object('ok', false, 'reason', 'That visit is someone else''s to correct.');
  end if;

  update public.site_checkins set note = nullif(btrim(p_note), '') where id = p_id;

  if p_file_ids is not null then
    foreach f in array p_file_ids loop
      if not exists (select 1 from public.files x where x.id = f and x.project_id = v_project) then
        return jsonb_build_object('ok', false, 'reason', 'One of those files does not belong to this project.');
      end if;
      update public.file_links set site_checkin_id = p_id where file_id = f and project_id = v_project;
      if not found then
        insert into public.file_links (file_id, project_id, site_checkin_id, role, created_by_user_id)
        values (f, v_project, p_id, 'progress', me);
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ---------------------------------------------------------------------------
-- REMOVE ONE. The entry goes; the files stay on the project, because they are
-- photographs of the work and the work happened whatever the note said.
create or replace function public.portal_site_visit_delete(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id();
  v_contact uuid; v_project uuid; v_owner uuid; v_day date;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;
  select u.contact_id into v_contact from public.app_users u where u.id = me;

  select l.project_id, l.contact_id, (ci.created_at at time zone 'America/New_York')::date
    into v_project, v_owner, v_day
    from public.site_checkins ci join public.site_checkin_links l on l.token = ci.link_token
   where ci.id = p_id and ci.kind = 'visit';
  if v_project is null then return jsonb_build_object('ok', false, 'reason', 'No such visit.'); end if;
  if not (v_owner = v_contact or public.is_superadmin()
          or coalesce(public.my_authority_rank(v_project), 0) >= 50) then
    return jsonb_build_object('ok', false, 'reason', 'That visit is someone else''s to remove.');
  end if;

  update public.file_links set site_checkin_id = null where site_checkin_id = p_id;
  delete from public.site_checkins where id = p_id;

  -- The roster row goes too, but only when nothing else that day says they
  -- were there - a marked roster is a fact about the day, not about the note.
  if not exists (
    select 1 from public.site_checkins ci join public.site_checkin_links l on l.token = ci.link_token
     where l.project_id = v_project and l.contact_id = v_owner
       and (ci.created_at at time zone 'America/New_York')::date = v_day) then
    delete from public.site_roster
     where project_id = v_project and on_date = v_day and contact_id = v_owner
       and marked_by_user_id is not null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- THE LINES. Every visit on the site, newest first, with who wrote it, what
-- they attached, and whether the person reading may change it.
create or replace function public.portal_site_visits(p_project uuid, p_limit int default 30)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  with me as (select u.id, u.contact_id from public.app_users u where u.id = public.current_app_user_id())
  select case when not public.is_project_member(p_project) then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id,
      'on_date', (v.created_at at time zone 'America/New_York')::date,
      'at', v.created_at,
      'note', v.note,
      'who', coalesce(c.person_name, c.name),
      'contact_id', l.contact_id,
      'mine', l.contact_id = (select contact_id from me),
      'can_edit', l.contact_id = (select contact_id from me)
                  or public.is_superadmin()
                  or coalesce(public.my_authority_rank(p_project), 0) >= 50,
      'files', coalesce((
        select jsonb_agg(jsonb_build_object('file_id', f.id, 'name', f.file_name, 'kind', f.kind,
                                            'bucket', f.bucket, 'path', f.path) order by f.created_at)
          from public.file_links fl join public.files f on f.id = fl.file_id
         where fl.site_checkin_id = v.id), '[]'::jsonb)
    ) order by v.created_at desc)
    from (select ci.* from public.site_checkins ci
           join public.site_checkin_links l2 on l2.token = ci.link_token
          where l2.project_id = p_project and ci.kind = 'visit'
          order by ci.created_at desc limit greatest(p_limit, 0)) v
    join public.site_checkin_links l on l.token = v.link_token
    left join public.contacts c on c.id = l.contact_id), '[]'::jsonb) end;
$$;

-- ---------------------------------------------------------------------------
-- WHO IS ON SITE THIS WEEK, by trade.
--
-- A trade is on the site this week if somebody of that trade was marked on
-- the roster in the week, or if there is open work in that trade dated inside
-- it. Both, because either alone lies: the roster misses a trade due Thursday
-- that has not turned up yet, and the tasks miss the crew that showed up
-- without a task on the board.
--
-- The trade of a task is resolved exactly as portal_tasks resolves it
-- (migration 066): its contract, else its scope line, else its person.
create or replace function public.portal_site_week(p_project uuid, p_week_of date default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_today date := coalesce(p_week_of, (now() at time zone 'America/New_York')::date);
  v_from  date := v_today - ((extract(isodow from v_today)::int - 1));
  v_to    date := v_from + 6;
  v_money boolean;
  v_out   jsonb;
begin
  if not public.is_project_member(p_project) and not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'You are not on this project.');
  end if;
  v_money := public.can_view_project_financials(p_project);

  with recursive fam as (
    select p.id from public.projects p where p.id = p_project
    union
    select p.id from public.projects p join fam on p.parent_project_id = fam.id
  ),
  -- Who was marked on site, and what they do.
  roster as (
    select r.contact_id, r.on_date,
           (select tr.trade from public.contact_trade_roles tr
              join public.trades t on t.trade = tr.trade
             where tr.contact_id = r.contact_id
               and (coalesce(t.is_construction, false) or coalesce(t.is_worker_trade, false))
             order by t.sort_order nulls last limit 1) as trade
      from public.site_roster r
     where r.project_id in (select id from fam) and r.on_date between v_from and v_to
  ),
  -- Open work dated inside the week, with its trade resolved.
  work as (
    select a.id, a.target_date, a.assigned_to_contact_id,
           coalesce(
             (select t3.trade from public.trades t3 where lower(t3.trade) = lower(ct.trade) limit 1),
             initcap(ct.trade),
             (select t4.trade from public.project_scope_items si
                left join public.trades t4 on lower(t4.trade) = lower(si.trade)
               where si.id = a.scope_item_id and si.trade is not null and lower(si.trade) <> 'all' limit 1),
             (select tr.trade from public.contact_trade_roles tr
                join public.trades t2 on t2.trade = tr.trade
               where tr.contact_id = a.assigned_to_contact_id
                 and (coalesce(t2.is_construction, false) or coalesce(t2.is_worker_trade, false))
               order by t2.sort_order nulls last limit 1)) as trade
      from public.actions a
      left join public.contracts ct on ct.id = a.contract_id
     where a.project_id in (select id from fam)
       and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
  ),
  trades as (
    select trade from roster where trade is not null
    union
    select trade from work where trade is not null and target_date between v_from and v_to
  )
  select jsonb_agg(x.j order by x.late desc, x.due desc, x.trade)
    into v_out
  from (
    select t.trade,
      (select count(*) from work w where w.trade = t.trade and w.target_date between v_from and v_to) as due,
      (select count(*) from work w where w.trade = t.trade and w.target_date < v_from) as late,
      jsonb_build_object(
        'trade', t.trade,
        'phase', (select tr.stage from public.trades tr where tr.trade = t.trade),
        'days_on_site', (select count(distinct r.on_date) from roster r where r.trade = t.trade),
        'people', coalesce((
          select jsonb_agg(distinct jsonb_build_object(
                   'contact_id', c.id, 'name', coalesce(c.person_name, c.name)))
            from roster r join public.contacts c on c.id = r.contact_id
           where r.trade = t.trade), '[]'::jsonb),
        'due_this_week', (select count(*) from work w where w.trade = t.trade and w.target_date between v_from and v_to),
        'late', (select count(*) from work w where w.trade = t.trade and w.target_date < v_from),
        'open', (select count(*) from work w where w.trade = t.trade),
        'contracts', case when v_money then coalesce((
          select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'amount', c.amount,
                   'paid', (select coalesce(sum(tx.amount), 0) from public.transactions tx
                             where tx.contract_id = c.id and tx.direction = 'out'
                               and coalesce(tx.status,'') in ('paid','paid - pending confirmation','paid - receipt filed','settled')))
                 order by c.amount desc nulls last)
            from public.contracts c
           where c.project_id in (select id from fam) and c.status <> 'placeholder'
             and lower(coalesce(c.trade, '')) = lower(t.trade)), '[]'::jsonb) else '[]'::jsonb end
      ) as j
    from trades t
  ) x;

  return jsonb_build_object('ok', true, 'from', v_from, 'to', v_to,
    'money', v_money, 'trades', coalesce(v_out, '[]'::jsonb));
end $$;

revoke all on function public.portal_site_visit_log(uuid, text, uuid[], date) from public, anon;
revoke all on function public.portal_site_visit_edit(uuid, text, uuid[]) from public, anon;
revoke all on function public.portal_site_visit_delete(uuid) from public, anon;
revoke all on function public.portal_site_visits(uuid, int) from public, anon;
revoke all on function public.portal_site_week(uuid, date) from public, anon;
grant execute on function public.portal_site_visit_log(uuid, text, uuid[], date) to authenticated, service_role;
grant execute on function public.portal_site_visit_edit(uuid, text, uuid[]) to authenticated, service_role;
grant execute on function public.portal_site_visit_delete(uuid) to authenticated, service_role;
grant execute on function public.portal_site_visits(uuid, int) to authenticated, service_role;
grant execute on function public.portal_site_week(uuid, date) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
