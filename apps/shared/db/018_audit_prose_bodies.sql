-- 018 - the audit records WHAT the prose changed to, in a table that can be
-- emptied later without changing any design. Shahar, 2026-09-09.
--
-- THE GAP THIS CLOSES. fn_log_change skipped notes, description, body, detail,
-- content, learnings and dependencies entirely, so a prose edit left no trace
-- at all. That bit today: renaming an action's title and rewriting its notes
-- logged only the priority change beside them, and the old text survived only
-- because it was quoted by hand into the new note.
--
-- THE DESIGN, and it is the whole point of the request:
--
--   change_events  stays LIGHT and stays FOREVER. A prose edit now writes a
--                  row here saying the field changed and how big each side
--                  was - "1240 chars" - never the text. Small, and enough to
--                  prove a change happened and who made it.
--
--   change_bodies  is HEAVY and DISPOSABLE. It holds the actual before and
--                  after, one row per change_events row, cascading on delete.
--
-- WHY THAT SPLIT MEANS PRUNING IS NEVER A DESIGN CHANGE: absence of a body
-- must never be read as "nothing changed". The light row is always there and
-- always says the field changed, so deleting bodies loses DETAIL, never FACT.
-- Any reader must treat a missing body as "not retained any more" - that is
-- the contract, and it is what lets the table be emptied on any schedule,
-- or entirely, with nothing else touched.
--
-- Retention is a NUMBER IN config, not code: audit_body_retention_days.
-- Change it whenever; null keeps bodies forever. Same shape as the
-- trash_retention_days precedent, so nothing new to learn.

create table if not exists public.change_bodies (
  change_event_id bigint primary key references public.change_events(id) on delete cascade,
  from_value      text,
  to_value        text,
  truncated       boolean not null default false,
  at              timestamptz not null default now()
);

comment on table public.change_bodies is
  'The before/after TEXT of a prose change. Disposable by design: the matching change_events row records that the field changed and stays forever, so deleting a body loses detail and never loses the fact. Pruned by purge_change_bodies() on config.audit_body_retention_days. A missing body means NOT RETAINED, never "unchanged".';

-- at is duplicated from the event so pruning by age never needs the join.
create index if not exists change_bodies_at on public.change_bodies (at);

alter table public.change_bodies enable row level security;
drop policy if exists superadmin_only on public.change_bodies;
-- Mirrors change_events exactly. Anything looser would make this a side door
-- onto prose the reader cannot see in the row itself.
create policy superadmin_only on public.change_bodies for all
  using (public.is_superadmin()) with check (public.is_superadmin());

alter table public.config
  add column if not exists audit_body_retention_days integer default 180;

comment on column public.config.audit_body_retention_days is
  'How long the TEXT of a prose change is kept in change_bodies. Null keeps it forever. The change_events row is never pruned by this - only the body.';

update public.config set audit_body_retention_days = 180 where audit_body_retention_days is null;

create or replace function public.fn_log_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_pk text;
  v_actor text;
  v_key text;
  -- Prose moved OUT of the skip list and into its own list: it is logged, but
  -- its text goes to change_bodies rather than into change_events.
  v_prose text[] := array[
    'notes','description','body','detail','content','learnings','dependencies',
    'action','title','desired_outcome','reason','summary','scope','blurb'];
  v_skip text[] := array[
    -- housekeeping: timestamps and actor stamps are metadata ABOUT a change, never the change itself
    'created_at','updated_at','last_updated','last_modified_at','schema_updated_at',
    'chat_instructions_updated_at','last_modified_by','updated_by','search_vector',
    -- v215: sign-in stamps and the welcome-video preference
    'login_count','last_login_at','welcome_video_dismissed_at'];
  v_actor_cols text[] := array['last_modified_by','updated_by','created_by','actor'];
  v_borrowed uuid;
  v_from text; v_to text; v_id bigint; v_cap constant integer := 20000; v_trunc boolean;
begin
  if TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD); v_new := null;
  elsif TG_OP = 'INSERT' then
    v_old := null; v_new := to_jsonb(NEW);
  else
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  end if;

  v_pk := coalesce(v_new, v_old) ->> TG_ARGV[0];

  v_actor := null;
  foreach v_key in array v_actor_cols loop
    if v_actor is null and (coalesce(v_new, v_old) ? v_key) then
      v_actor := coalesce(v_new, v_old) ->> v_key;
    end if;
  end loop;
  v_actor := coalesce(v_actor, current_setting('sgr.app_user_id', true), 'system');

  v_borrowed := public.borrowed_seat();
  if v_borrowed is not null then
    v_actor := v_actor || ' [via admin '
      || coalesce((select u.email from public.app_users u where u.id = public.real_app_user_id()), '?')
      || case when public.borrowed_can_act() then ' acting as ' else ' viewing as ' end
      || coalesce((select u.email from public.app_users u where u.id = v_borrowed), '?')
      || ']';
  end if;

  if TG_OP = 'INSERT' then
    insert into change_events(table_name, row_id, op, actor)
    values (TG_TABLE_NAME, v_pk, 'insert', v_actor);
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    insert into change_events(table_name, row_id, op, actor)
    values (TG_TABLE_NAME, v_pk, 'delete', v_actor);
    return OLD;
  end if;

  for v_key in select jsonb_object_keys(v_new) loop
    if v_key = any(v_skip) then continue; end if;
    if (v_old ->> v_key) is distinct from (v_new ->> v_key) then
      if v_key = any(v_prose) then
        v_from := v_old ->> v_key;
        v_to   := v_new ->> v_key;
        -- The light row: the fact and the shape of it, never the text.
        insert into change_events(table_name, row_id, field, from_value, to_value, op, actor)
        values (TG_TABLE_NAME, v_pk, v_key,
                case when v_from is null then null else length(v_from) || ' chars' end,
                case when v_to   is null then null else length(v_to)   || ' chars' end,
                'update', v_actor)
        returning id into v_id;
        -- The heavy row: capped, so one pathological value cannot run away
        -- with the table.
        v_trunc := coalesce(length(v_from), 0) > v_cap or coalesce(length(v_to), 0) > v_cap;
        insert into change_bodies(change_event_id, from_value, to_value, truncated)
        values (v_id, left(v_from, v_cap), left(v_to, v_cap), v_trunc);
      else
        insert into change_events(table_name, row_id, field, from_value, to_value, op, actor)
        values (TG_TABLE_NAME, v_pk, v_key, v_old ->> v_key, v_new ->> v_key, 'update', v_actor);
      end if;
    end if;
  end loop;

  return NEW;
end;
$function$;

-- The cleanup. Deletes BODIES only; the events they belong to are untouched,
-- which is what makes this safe to run at any cadence, or by hand, forever.
create or replace function public.purge_change_bodies()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_days integer; v_n integer;
begin
  select audit_body_retention_days into v_days from public.config limit 1;
  if v_days is null then
    return jsonb_build_object('ok', true, 'skipped', 'retention is null - bodies kept forever');
  end if;
  delete from public.change_bodies where at < now() - make_interval(days => v_days);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n, 'kept_days', v_days, 'at', now());
end $$;

revoke all on function public.purge_change_bodies() from public, anon, authenticated;
grant execute on function public.purge_change_bodies() to service_role;

select cron.schedule('purge-change-bodies', '10 4 * * *', 'select public.purge_change_bodies()');

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
