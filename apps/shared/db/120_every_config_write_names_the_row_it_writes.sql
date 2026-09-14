-- 120. EVERY CONFIG WRITE NAMES THE ROW IT WRITES.
--
-- Shahar (2026-09-14): "unable to load this photo as landing photo" - and the
-- screen said why, right next to the button: UPDATE requires a WHERE clause.
--
-- That is pg_safeupdate. Supabase preloads it into the role PostgREST logs in
-- as:
--
--   authenticator  session_preload_libraries = supautils, safeupdate
--
-- so every statement served through the API runs with it loaded, and a bare
-- UPDATE - one that would rewrite every row in a table - is refused. It is a
-- session-level hook, not a permission, so SECURITY DEFINER does not get past
-- it and neither does being a superadmin.
--
-- config holds exactly one row, so `update config set x = y` reads as
-- perfectly safe and was written that way five times. It is still a bare
-- update, and the guard cannot know the table has one row. Every one of these
-- has been failing from the app since the guard was turned on:
--
--   landing_hero_set        the landing photograph
--   public_tagline_set      the line under the logo
--   set_welcome_video_url   the first-run video
--   set_trash_retention_days
--   set_storage_op          (twice - backup and optimization)
--
-- The whole admin config surface, not one button. Nobody noticed because
-- every probe any of us ever ran went through the postgres role, which does
-- not load safeupdate - the failure only exists on the path a person uses.
--
-- The fix is to say which row, which is what the guard is asking for and also
-- what the code meant. Not `where true`: the planner folds a constant
-- predicate away and the statement arrives at the executor with no qual at
-- all, which is exactly what the guard is looking for. Reading the id into a
-- variable first leaves a real comparison in the plan, and reads as the
-- intention did - the config row, singular.

create or replace function public.landing_hero_set(p_url text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v_url text := nullif(btrim(p_url), ''); v_id uuid;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Only a Green Bergen admin can change the landing photo.');
  end if;
  if v_url is not null and v_url not like 'https://%/storage/v1/object/public/public-media/%' then
    return jsonb_build_object('ok', false, 'reason', 'That has to be a photo uploaded here, not a link to somewhere else.');
  end if;
  select id into v_id from public.config limit 1;
  update public.config set landing_hero_url = v_url where id = v_id;
  return jsonb_build_object('ok', true, 'url', v_url);
end $fn$;

create or replace function public.public_tagline_set(p_tagline text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v text := nullif(btrim(coalesce(p_tagline, '')), ''); v_id uuid;
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Admins only.');
  end if;
  if v is not null and length(v) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'Keep it under 120 characters - it sits under the logo.');
  end if;
  select id into v_id from public.config limit 1;
  update public.config set public_tagline = v, public_tagline_updated_at = now() where id = v_id;
  return jsonb_build_object('ok', true, 'tagline', v);
end $fn$;

create or replace function public.set_welcome_video_url(p_url text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v_id uuid;
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Only an administrator may change this.');
  end if;
  select id into v_id from public.config limit 1;
  update public.config set welcome_video_url = nullif(btrim(p_url), '') where id = v_id;
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.set_trash_retention_days(p_days integer)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v_id uuid;
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Only an administrator may change this.');
  end if;
  if p_days < 1 or p_days > 365 then
    return jsonb_build_object('ok', false, 'reason', 'Retention must be between 1 and 365 days.');
  end if;
  select id into v_id from public.config limit 1;
  update public.config set trash_retention_days = p_days where id = v_id;
  return jsonb_build_object('ok', true, 'days', p_days);
end $fn$;

create or replace function public.set_storage_op(p_op text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v_id uuid;
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Admins only.');
  end if;
  select id into v_id from public.config limit 1;
  if p_op = 'backup' then
    update public.config set last_backup_at = now() where id = v_id;
  elsif p_op = 'optimization' then
    update public.config set last_storage_optimization_at = now() where id = v_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'Unknown op.');
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

comment on function public.landing_hero_set(text) is
  'Records the landing photograph on config. Names the config row in a WHERE clause: pg_safeupdate is preloaded into the authenticator role, so a bare UPDATE is refused on every path a person actually uses.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
