-- 123. ONE LINE, NOT TWO, AND A SWITCH FOR IT.
--
-- Shahar (2026-09-14): "you are right, the public tagline and the line over
-- it are the same. kill the line over it and keep only the tag line. next to
-- it, set a checkbox - click to display and remove to hide."
--
-- An hour earlier I argued they were two different jobs: "what is this
-- company" under the wordmark, "what do you do for me" over the photograph.
-- Seeing the two fields stacked in the console he is right and I was
-- splitting hairs. They are both one line of copy a stranger reads first, and
-- keeping two of them only means writing the same sentence twice and then
-- wondering which one is stale.
--
-- So landing_hero_line goes, one migration after it arrived, and the hero
-- draws public_tagline instead - shown or not, by a switch. The real question
-- was never which words, but whether any words belong on a photograph that
-- already carries its own headline. His does, so the switch starts off.
alter table public.config add column if not exists public_tagline_shown boolean not null default true;

comment on column public.config.public_tagline_shown is
  'Whether the tagline is drawn over the homeowner landing photograph. Off for a photo that carries its own headline; the line under the wordmark is a different placement and is not affected.';

update public.config
   set public_tagline_shown = false
 where id = (select c.id from public.config c limit 1);

drop function if exists public.landing_line_set(text);
alter table public.config drop column if exists landing_hero_line;

create or replace function public.public_tagline_set(p_tagline text, p_shown boolean default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v text := nullif(btrim(coalesce(p_tagline, '')), ''); v_id uuid;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Admins only.');
  end if;
  if v is not null and length(v) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'Keep it under 120 characters - it sits under the logo.');
  end if;
  select id into v_id from public.config limit 1;
  update public.config
     set public_tagline = v,
         public_tagline_updated_at = now(),
         public_tagline_shown = coalesce(p_shown, public_tagline_shown)
   where id = v_id;
  return jsonb_build_object('ok', true, 'tagline', v,
    'shown', (select c.public_tagline_shown from public.config c where c.id = v_id));
end $fn$;

comment on function public.public_tagline_set(text, boolean) is
  'The one line a stranger reads, and whether it is drawn over the homeowner landing photograph. Admins only.';

grant execute on function public.public_tagline_set(text, boolean) to authenticated;

create or replace function public.public_settings()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select jsonb_build_object(
           'tagline', c.public_tagline,
           'tagline_shown', c.public_tagline_shown,
           'hero', c.landing_hero_url)
    from public.config c limit 1;
$fn$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
