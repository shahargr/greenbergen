-- 053 - "from" is the floor of the package, computed where the package is.
--
-- Shahar (2026-09-10): the landing card under the generator said "from
-- $11,800" while the package page showed less. Both were right about
-- different numbers: $11,800 is the basic setup (22 kW), and the 14 kW
-- answer takes $2,400 off, so the cheapest configuration is $9,400. A
-- line that says "from" must say the cheapest, and it must come from the
-- package itself - the base price plus the lowest answer on every lever -
-- so an edit to a price or an option moves every panel at once.
--
-- The default answer of every lever is +$0 (045), so a lever's floor is
-- never above zero; a package with no levers is its base price.
create or replace function public.homeowner_catalogue_tiles()
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', p.code, 'tile_title', p.tile_title, 'tile_line2', p.tile_line2,
    'tile_group', p.tile_group, 'availability', p.availability,
    'illustration', p.illustration, 'sort_order', p.sort_order,
    'category', p.category, 'season_months', p.season_months,
    'trade', p.trade,
    'covered', public.homeowner_trade_covered(p.trade),
    'photo_url', p.photo_url, 'promote', p.promote,
    'base_price_cents', p.base_price_cents,
    -- The cheapest configuration: base plus the lowest delta on each lever.
    'from_price_cents', case when p.base_price_cents is null then null else
      p.base_price_cents + coalesce((
        select sum(m.lo) from (
          select min(o.price_delta_cents) as lo
            from public.blueprint_package_levers l
            join public.blueprint_package_lever_options o on o.lever_id = l.id
           where l.package_code = p.code
           group by l.id) m), 0) end)
    order by p.sort_order, p.name), '[]'::jsonb)
  from public.blueprint_packages p
  where p.is_active;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
