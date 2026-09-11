-- 059 - admin usage stats: who uses the system and what they do in it.
--
-- Shahar (2026-09-11): "for admin add a stats screen showing users usage in
-- the system / website, and tasks made, to understand usage and
-- engagements." One read, superadmin only, over what the system already
-- records about people: app_users (joined, last login, login count),
-- auth.users.last_sign_in_at, change_events (every write, with the actor -
-- an app_user id when a person did it through an app), actions (created,
-- completed, by domain, person versus system), project_bookings,
-- messages, files, transactions, site_checkins, package_video_events,
-- app_invitations, contractor_approvals. No new table: the log the
-- triggers have kept since day one IS the usage record.
--
-- Website traffic (visitors who never sign in) is not in the database and
-- cannot be, per rulebook 71 (the anon surface is read-only). That is
-- Vercel Web Analytics: the apps carry its script; the dashboard is
-- Vercel's, and the stats screen links to it.
create or replace function public.admin_usage_stats(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_days int := greatest(coalesce(p_days, 30), 1);
  since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  closed constant text[] := array['Completed','Cancelled','Force Cancelled','Superseded'];
begin
  if not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'Administrators only.'); end if;

  return jsonb_build_object(
    'ok', true, 'days', v_days, 'since', since,

    'users', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where u.is_active and u.disabled_at is null),
        'new', count(*) filter (where u.created_at >= since),
        'seen_7d', count(*) filter (where greatest(u.last_login_at, la.last_sign_in_at) >= now() - interval '7 days'),
        'seen_30d', count(*) filter (where greatest(u.last_login_at, la.last_sign_in_at) >= now() - interval '30 days'),
        'never_signed_in', count(*) filter (where coalesce(u.login_count, 0) = 0 and la.last_sign_in_at is null),
        'superadmins', count(*) filter (where u.is_superadmin))
      from public.app_users u left join auth.users la on la.id = u.auth_user_id),

    'doors', jsonb_build_object(
      'homeowners', (select count(distinct pm.app_user_id) from public.project_members pm
                       join public.projects p on p.id = pm.project_id
                      where pm.status = 'active' and p.asset_id is not null and pm.app_user_id is not null),
      'contractors', (select count(*) from public.app_users u
                       where exists (select 1 from public.contractor_approvals ca where ca.contact_id = u.contact_id)
                          or exists (select 1 from public.contact_trade_roles r where r.contact_id = u.contact_id)),
      'approved_contractors', (select count(*) from public.contractor_approvals where status = 'approved'),
      'pending_contractors', (select count(*) from public.contractor_approvals where status not in ('approved','rejected','declined'))),

    'invitations', (
      select jsonb_build_object(
        'sent', count(*),
        'accepted', count(*) filter (where accepted_at is not null or status = 'accepted'),
        'pending', count(*) filter (where status = 'pending' and expires_at > now()),
        'in_period', count(*) filter (where created_at >= since))
      from public.app_invitations),

    'bookings', (
      select jsonb_build_object(
        'total', count(*),
        'in_period', count(*) filter (where created_at >= since),
        'by_state', (select coalesce(jsonb_object_agg(s.state, s.n), '{}'::jsonb) from (select state, count(*) n from public.project_bookings group by 1) s),
        'by_package', (select coalesce(jsonb_agg(jsonb_build_object('code', s.package_code, 'n', s.n) order by s.n desc), '[]'::jsonb)
                         from (select package_code, count(*) n from public.project_bookings group by 1) s))
      from public.project_bookings),

    'tasks', (
      select jsonb_build_object(
        'open', count(*) filter (where status <> all(closed)),
        'created_in_period', count(*) filter (where created_at >= since),
        'completed_in_period', count(*) filter (where completed_on >= since::date),
        'created_by_people', count(*) filter (where created_at >= since
                                                and coalesce(source, '') not like 'system%'
                                                and coalesce(created_by, '') not ilike 'system%'),
        'created_by_system', count(*) filter (where created_at >= since
                                                and (coalesce(source, '') like 'system%' or coalesce(created_by, '') ilike 'system%')),
        'by_domain', (select coalesce(jsonb_agg(jsonb_build_object('domain', d.domain, 'open', d.o, 'created', d.c, 'completed', d.k)
                                                  order by d.c desc, d.o desc), '[]'::jsonb)
                        from (select coalesce(domain, '(none)') as domain,
                                     count(*) filter (where status <> all(closed)) as o,
                                     count(*) filter (where created_at >= since) as c,
                                     count(*) filter (where completed_on >= since::date) as k
                                from public.actions group by 1 order by 3 desc, 2 desc limit 8) d))
      from public.actions),

    'engagement', jsonb_build_object(
      'messages', (select count(*) from public.messages where created_at >= since),
      'files', (select count(*) from public.files where created_at >= since),
      'payments', (select count(*) from public.transactions where created_at >= since),
      'checkins', (select count(*) from public.site_checkins where created_at >= since),
      'video_plays', (select count(*) from public.package_video_events where created_at >= since and event = 'play'),
      'writes', (select count(*) from public.change_events where at >= since and actor ~ '^[0-9a-f-]{36}$')),

    -- One row per day of the period: what people did.
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d::date,
        'active_users', (select count(distinct actor) from public.change_events e
                          where e.at >= d and e.at < d + interval '1 day' and e.actor ~ '^[0-9a-f-]{36}$'),
        'writes', (select count(*) from public.change_events e
                    where e.at >= d and e.at < d + interval '1 day' and e.actor ~ '^[0-9a-f-]{36}$'),
        'tasks_created', (select count(*) from public.actions a where a.created_at >= d and a.created_at < d + interval '1 day'),
        'tasks_completed', (select count(*) from public.actions a where a.completed_on = d::date),
        'bookings', (select count(*) from public.project_bookings b where b.created_at >= d and b.created_at < d + interval '1 day'),
        'messages', (select count(*) from public.messages m where m.created_at >= d and m.created_at < d + interval '1 day'),
        'files', (select count(*) from public.files f where f.created_at >= d and f.created_at < d + interval '1 day')
      ) order by d), '[]'::jsonb)
      from generate_series(since, date_trunc('day', now()), interval '1 day') d),

    -- Every account, most recently active first.
    'people', (
      select coalesce(jsonb_agg(p order by (p->>'last_activity') desc nulls last, (p->>'last_seen') desc nulls last), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', u.id, 'name', coalesce(u.full_name, u.username), 'email', u.email,
          'joined', u.created_at, 'last_seen', greatest(u.last_login_at, la.last_sign_in_at),
          'logins', coalesce(u.login_count, 0), 'is_superadmin', u.is_superadmin,
          'active', u.is_active and u.disabled_at is null, 'plan', u.plan_code,
          'homes', (select count(*) from public.project_members pm join public.projects p on p.id = pm.project_id
                     where pm.app_user_id = u.id and pm.status = 'active' and p.asset_id is not null),
          'seats', (select count(*) from public.project_members pm where pm.app_user_id = u.id and pm.status = 'active'),
          'contractor', exists (select 1 from public.contractor_approvals ca where ca.contact_id = u.contact_id)
                     or exists (select 1 from public.contact_trade_roles r where r.contact_id = u.contact_id),
          'last_activity', (select max(e.at) from public.change_events e where e.actor = u.id::text),
          'writes', (select count(*) from public.change_events e where e.actor = u.id::text and e.at >= since),
          'tasks_created', (select count(*) from public.change_events e where e.actor = u.id::text and e.table_name = 'actions' and e.op = 'insert' and e.at >= since),
          'tasks_closed', (select count(*) from public.change_events e where e.actor = u.id::text and e.table_name = 'actions'
                             and e.field = 'status' and e.to_value like 'Completed%' and e.at >= since),
          'messages', (select count(*) from public.messages m where m.from_contact_id = u.contact_id and m.created_at >= since),
          'files', (select count(*) from public.files f where f.uploaded_by_user_id = u.id and f.created_at >= since),
          'bookings', (select count(*) from public.project_bookings b join public.projects p on p.id = b.project_id
                        where p.owner_user_id = u.id and b.created_at >= since),
          'payments', (select count(*) from public.change_events e where e.actor = u.id::text and e.table_name = 'transactions' and e.op = 'insert' and e.at >= since)
        ) as p
        from public.app_users u left join auth.users la on la.id = u.auth_user_id
      ) x),

    -- What gets touched: the tables people write to most in the period.
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object('table', t.table_name, 'writes', t.n, 'people', t.p) order by t.n desc), '[]'::jsonb)
      from (select table_name, count(*) n, count(distinct actor) p from public.change_events
             where at >= since and actor ~ '^[0-9a-f-]{36}$' group by 1 order by 2 desc limit 10) t)
  );
end $$;
revoke all on function public.admin_usage_stats(integer) from public, anon;
grant execute on function public.admin_usage_stats(integer) to authenticated, service_role;

insert into public.help (doc_type, topic, title, applies_to, sort_order, created_by, content)
values ('how_to', 'access',
  'Admin > Usage - who uses the system and what they do (Shahar 2026-09-11)',
  'app_users, auth.users, change_events, actions, project_bookings, messages, files, transactions, admin_usage_stats, portal /admin/stats',
  140, 'claude',
  'BUILT 2026-09-11 (migration 059). /admin/stats in the portal draws admin_usage_stats(days) - superadmin only, period 7 / 30 / 90 days. No new table: the record of usage is what the system already keeps. app_users.last_login_at / login_count and auth.users.last_sign_in_at say who signed in and when; change_events (fn_log_change on every table) says who WROTE what and when - the actor is the app_user id when a person acted through an app, a name like claude or a system: prefix otherwise, and only uuid actors count as people; actions say what tasks were made (created_at, created_by / source person versus system) and closed (completed_on), by domain; project_bookings, messages, files, transactions, site_checkins and package_video_events are the engagement counts. The screen: the numbers (accounts, new, seen in 7 and 30 days, never signed in; homeowners with a home, contractors, approvals pending; invitations sent / accepted / pending), a day-by-day chart of people active, writes, tasks made and closed, bookings and messages, the tasks by domain, the tables people touch most, and one row per account - joined, last seen, logins, writes, tasks made / closed, messages, files, bookings, payments logged in the period. WEBSITE TRAFFIC - visitors who never sign in - is NOT here and cannot be: the anon surface is read-only (rulebook 71). The three apps carry the Vercel Web Analytics script (@vercel/analytics); enable Web Analytics on each Vercel project and the visitors, page views, routes and referrers live in Vercel''s dashboard, which the stats screen links to.');

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
