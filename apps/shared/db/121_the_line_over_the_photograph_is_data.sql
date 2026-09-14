-- 121. THE LINE OVER THE PHOTOGRAPH IS DATA.
--
-- Shahar (2026-09-14): "where is this configured: 'We get things done around
-- your house'. it shows on the home owner landing page. if its hard coded,
-- move it into the console with field i can update."
--
-- It was hard coded - HOME_LINE, a constant in HomeHero.tsx, drawn on both
-- home screens (the front door a stranger lands on, and the one a member
-- lands on). The photograph under it has been editable since migration 072;
-- the sentence on top of it needed a deploy. That is the wrong way round: of
-- the two, the words are the thing you rewrite on a Tuesday afternoon.
--
-- It is NOT public_tagline. That one sits under the wordmark on public pages
-- in all four apps and answers "what is this company"; this is the headline
-- across the hero and answers "what do you do for me". Two lines, two places,
-- two jobs - and a single field driving both would make every edit a
-- compromise between them.
--
-- Seeded with exactly what the constant said, so nothing moves on the page
-- until somebody decides it should.
alter table public.config add column if not exists landing_hero_line text;

comment on column public.config.landing_hero_line is
  'The headline across the homeowner hero photograph, on both the front door and the member home. Null falls back to the constant in the app, so the page is never wordless.';

update public.config
   set landing_hero_line = coalesce(landing_hero_line, 'We get things done around your house')
 where id = (select c.id from public.config c limit 1);

create or replace function public.landing_line_set(p_line text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v text := nullif(btrim(coalesce(p_line, '')), ''); v_id uuid;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Only a Green Bergen admin can change the landing headline.');
  end if;
  -- It is set over a photograph at the top of a phone screen. Past about a
  -- hundred characters it stops being a headline and starts being a
  -- paragraph with a picture behind it.
  if v is not null and length(v) > 100 then
    return jsonb_build_object('ok', false, 'reason',
      'Keep it under 100 characters - it is set large, over the photo, on a phone.');
  end if;
  -- Emptying it is a real intention: the app's own wording comes back.
  select id into v_id from public.config limit 1;
  update public.config set landing_hero_line = v where id = v_id;
  return jsonb_build_object('ok', true, 'line', v);
end $fn$;

comment on function public.landing_line_set(text) is
  'Sets the headline over the homeowner landing photograph. Blank restores the app''s built-in line. Admins only.';

grant execute on function public.landing_line_set(text) to authenticated;

-- The one read every public page already makes, now carrying the line with
-- the photograph it sits on - so both arrive together or neither does.
create or replace function public.public_settings()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select jsonb_build_object(
           'tagline', c.public_tagline,
           'hero', c.landing_hero_url,
           'line', c.landing_hero_line)
    from public.config c limit 1;
$fn$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
