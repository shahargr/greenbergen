-- 193: BOB GETS A FACE.
--
-- Shahar (2026-09-19), on the homeowner home screen: "This page should lead
-- with Ask Bob, like a search screen with audio / video recording option. In
-- a background of knowledge handyman."
--
-- The photograph behind him is DATA, the same way the landing photograph has
-- been since migration 072 - an admin uploads it, nothing in the app ships an
-- image of a person. Its own field rather than reusing landing_hero_url,
-- because the two say different things: the landing photograph is a couple in
-- front of the house they just finished, and this one is somebody who knows
-- how to do the work. Putting the first behind a search box would be a lie
-- about what the box does.
--
-- With none set the screen draws its own ground and loses nothing: Bob is the
-- search box, not the picture.

alter table public.config add column if not exists bob_hero_url text;

comment on column public.config.bob_hero_url is
  'The photograph behind Ask Bob on the homeowner home screen - somebody who knows the work. Uploaded through admin like the landing photo; null draws the plain ground.';

-- The same road, the same rule: uploaded here or not at all. An address
-- somewhere else is how a page ends up serving a picture nobody in this
-- building can take down.
create or replace function public.bob_hero_set(p_url text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_url text := nullif(btrim(p_url), ''); v_id uuid;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Only a Green Bergen admin can change that photo.');
  end if;
  if v_url is not null and v_url not like 'https://%/storage/v1/object/public/public-media/%' then
    return jsonb_build_object('ok', false, 'reason', 'That has to be a photo uploaded here, not a link to somewhere else.');
  end if;
  select id into v_id from public.config limit 1;
  update public.config set bob_hero_url = v_url where id = v_id;
  return jsonb_build_object('ok', true, 'url', v_url);
end $$;
revoke all on function public.bob_hero_set(text) from public, anon;
grant execute on function public.bob_hero_set(text) to authenticated;

-- One more key on the settings every public screen already reads, so the home
-- screen does not pay a second round trip for one address.
create or replace function public.public_settings()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'tagline', c.public_tagline,
           'tagline_shown', c.public_tagline_shown,
           'hero', c.landing_hero_url,
           'bob_hero', c.bob_hero_url)
    from public.config c limit 1;
$$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
