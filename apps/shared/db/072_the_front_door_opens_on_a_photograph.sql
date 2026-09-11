-- 072 - the front door opens on a photograph, and the rail leads with four.
--
-- Shahar (2026-09-11): "homeowner landing page. 1st 1/3 of page should be an
-- image, and not text. image of couple in front of their house smiling as if
-- they have completed a great project. below, have one line carousel of
-- projects they can do, starting with an EV charger, Standby generator, Water
-- heater replacement, and fixing Toilet..."
--
-- Two things, both data so neither needs a deploy to change again.
--
-- 1. config.landing_hero_url - the photograph at the top of the homeowner
--    landing page, uploaded in Admin the same way a package photo is (straight
--    to public-media, then the address recorded here). public_settings()
--    hands it to the app beside the tagline, so an anonymous visitor gets it
--    through the same cached read and no new round trip. Empty draws the
--    house line art on the warm ground, so the page is never broken while
--    nobody has taken the photograph yet.
--
-- 2. The rail's first four. featured() returns the promoted packages in
--    sort_order, so the order he named IS the data: EV charger, standby
--    generator, water heater, toilet. Toilet joins the promoted set and takes
--    the fourth seat; garage heater moves down to seven to make room, and the
--    faucet falls out of the six the rail shows (it is still in the
--    catalogue, one tap away, and still promoted).

alter table public.config add column if not exists landing_hero_url text;

comment on column public.config.landing_hero_url is
  'The photograph across the top third of the homeowner landing page - a public-media URL, uploaded in Admin. Empty draws the line art instead.';

create or replace function public.public_settings()
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object('tagline', c.public_tagline, 'hero', c.landing_hero_url)
    from public.config c limit 1;
$$;

-- Superadmin only, like every other line of public copy. The URL must be one
-- of ours: this address is rendered into an <img> on a page strangers read,
-- and a setting that can point it anywhere is a setting that will one day
-- point somewhere else.
create or replace function public.landing_hero_set(p_url text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_url text := nullif(btrim(p_url), '');
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Only a Green Bergen admin can change the landing photo.');
  end if;
  if v_url is not null and v_url not like 'https://%/storage/v1/object/public/public-media/%' then
    return jsonb_build_object('ok', false, 'reason', 'That has to be a photo uploaded here, not a link to somewhere else.');
  end if;
  update public.config set landing_hero_url = v_url;
  return jsonb_build_object('ok', true, 'url', v_url);
end $$;
revoke all on function public.landing_hero_set(text) from public, anon;
grant execute on function public.landing_hero_set(text) to authenticated, service_role;

-- THE FOUR THE RAIL LEADS WITH.
update public.blueprint_packages set sort_order = 7  where code = 'garage_heater';
update public.blueprint_packages set promote = true, sort_order = 4 where code = 'toilet';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
