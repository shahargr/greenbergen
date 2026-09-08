-- 013 - the tagline stops being a string literal in four apps.
--
-- "Bergen County community, not a marketplace." was hardcoded in
-- apps/shared/src/ui.tsx and again in two app layouts, so changing five words
-- meant a deploy. It is marketing copy: it belongs where Shahar can edit it.
--
-- public.config is the existing single-row settings table (rulebook 30: extend
-- what models this, do not stand up a parallel one). It already holds
-- welcome_video_url, trash_retention_days and the chat instructions.
--
-- After the logo lockup this line only renders on PUBLIC pages: signed in, the
-- app's own name sits under the wordmark instead. So this is the pitch a
-- stranger reads, and nothing else.
alter table public.config
  add column if not exists public_tagline text,
  add column if not exists public_tagline_updated_at timestamptz;

comment on column public.config.public_tagline is
  'The line under the wordmark on public pages. Null falls back to the app default. Signed-in screens show the app name instead (the logo lockup), so this is the pitch to a stranger.';

update public.config
   set public_tagline = 'A real community, not just a marketplace.',
       public_tagline_updated_at = now()
 where public_tagline is null;

create or replace function public.public_settings()
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select jsonb_build_object('tagline', c.public_tagline)
    from public.config c limit 1;
$$;

revoke all on function public.public_settings() from public;
grant execute on function public.public_settings() to anon, authenticated, service_role;

-- Superadmin only, and it checks rather than trusting the caller (rulebook 71:
-- the grant is the boundary, and the function checks again).
create or replace function public.public_tagline_set(p_tagline text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v text := nullif(btrim(coalesce(p_tagline, '')), '');
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Admins only.');
  end if;
  if v is not null and length(v) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'Keep it under 120 characters - it sits under the logo.');
  end if;
  update public.config set public_tagline = v, public_tagline_updated_at = now();
  return jsonb_build_object('ok', true, 'tagline', v);
end $$;

revoke all on function public.public_tagline_set(text) from public, anon;
grant execute on function public.public_tagline_set(text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
