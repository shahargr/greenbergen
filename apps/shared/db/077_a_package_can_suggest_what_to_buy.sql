-- 077 - a package can suggest what to buy, and the EV charger prices labour.
--
-- Shahar (2026-09-12), on the EV charger package:
--   "Change price to $750 for labor including the list provided already.
--    Change the 'Levers' to customize. Remove the chat for now.
--    Build a list of suggested products to purchase as part of the package,
--    which is optional. Just grab the product name, rating if you have,
--    price, and short link stating the product and store (ex. EVIQO Level 2
--    EV - Amazon)"
--
-- The package now buys the LABOUR - the permit, the circuit, the mounting,
-- the testing, the inspection, the insurance and the warranty - at $750, and
-- the charger is the member's own purchase from whoever they like. Which
-- makes the suggestions a real part of the page rather than a nicety: the
-- price stops answering "what do I end up with", so the list has to.
--
-- WHAT WE STORE AND WHAT WE DO NOT PROMISE. A price and a rating scraped from
-- a shop are true on the day and not after it, so every row carries
-- checked_on and the page says "as of" beside them. A row nobody has recorded
-- a price or a rating for shows NEITHER rather than a guess - which is the
-- state both seeds land in, because Amazon is blocked by this environment's
-- network policy and a number I cannot read is a number I will not invent.
-- Admin fills them in (admin_package_product_save) and the date stamps itself.
create table if not exists public.blueprint_package_products (
  id uuid primary key default gen_random_uuid(),
  package_code text not null references public.blueprint_packages(code) on update cascade on delete cascade,
  name text not null,
  store text not null,
  url text not null,
  price_cents integer check (price_cents is null or price_cents >= 0),
  rating numeric(2,1) check (rating is null or (rating >= 0 and rating <= 5)),
  rating_count integer check (rating_count is null or rating_count >= 0),
  note text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  checked_on date,
  created_at timestamptz not null default now(),
  created_by text default 'claude',
  last_modified_at timestamptz,
  last_modified_by text
);
create index if not exists idx_package_products_code on public.blueprint_package_products (package_code, sort_order);

comment on table public.blueprint_package_products is
  'Things a member may buy themselves as part of a package - the charger, the fixture, the unit. OPTIONAL and never part of the price: the package buys the labour. price_cents and rating are a snapshot of what the store showed on checked_on, never a promise, and null means nobody has recorded one.';

alter table public.blueprint_package_products enable row level security;
drop policy if exists blueprint_package_products_read on public.blueprint_package_products;
create policy blueprint_package_products_read on public.blueprint_package_products
  for select to authenticated using (true);
drop policy if exists blueprint_package_products_admin on public.blueprint_package_products;
create policy blueprint_package_products_admin on public.blueprint_package_products
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- Read by the package page, which strangers see, so anon may call it.
create or replace function public.homeowner_package_products(p_code text)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'store', p.store, 'url', p.url,
    'price_cents', p.price_cents, 'rating', p.rating, 'rating_count', p.rating_count,
    'note', p.note, 'checked_on', p.checked_on
  ) order by p.sort_order, p.name), '[]'::jsonb)
  from public.blueprint_package_products p
  where p.package_code = p_code and p.is_active
$$;
grant execute on function public.homeowner_package_products(text) to anon, authenticated, service_role;

create or replace function public.admin_package_product_save(p_id uuid, p_code text, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid := p_id; v_name text; v_url text; v_store text;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Only a Green Bergen admin can change the catalogue.');
  end if;
  v_name := nullif(btrim(p_patch->>'name'), '');
  v_url := nullif(btrim(p_patch->>'url'), '');
  v_store := coalesce(nullif(btrim(p_patch->>'store'), ''), 'Amazon');
  if v_name is null or v_url is null then
    return jsonb_build_object('ok', false, 'reason', 'A product needs a name and a link.');
  end if;
  if v_url not like 'https://%' then
    return jsonb_build_object('ok', false, 'reason', 'The link has to be an https address.');
  end if;

  if v_id is null then
    insert into public.blueprint_package_products
      (package_code, name, store, url, price_cents, rating, rating_count, note, sort_order, checked_on, created_by)
    values (p_code, v_name, v_store, v_url,
            nullif(btrim(p_patch->>'price_cents'), '')::int,
            nullif(btrim(p_patch->>'rating'), '')::numeric,
            nullif(btrim(p_patch->>'rating_count'), '')::int,
            nullif(btrim(p_patch->>'note'), ''),
            coalesce(nullif(btrim(p_patch->>'sort_order'), '')::int, 100),
            case when nullif(btrim(p_patch->>'price_cents'), '') is not null
                   or nullif(btrim(p_patch->>'rating'), '') is not null
                 then current_date end,
            'admin')
    returning id into v_id;
  else
    update public.blueprint_package_products set
      name = v_name, store = v_store, url = v_url,
      price_cents = nullif(btrim(p_patch->>'price_cents'), '')::int,
      rating = nullif(btrim(p_patch->>'rating'), '')::numeric,
      rating_count = nullif(btrim(p_patch->>'rating_count'), '')::int,
      note = nullif(btrim(p_patch->>'note'), ''),
      sort_order = coalesce(nullif(btrim(p_patch->>'sort_order'), '')::int, sort_order),
      checked_on = case when nullif(btrim(p_patch->>'price_cents'), '') is not null
                          or nullif(btrim(p_patch->>'rating'), '') is not null
                        then current_date else checked_on end,
      last_modified_at = now(), last_modified_by = 'admin'
    where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.admin_package_product_save(uuid, text, jsonb) from public, anon;
grant execute on function public.admin_package_product_save(uuid, text, jsonb) to authenticated, service_role;

create or replace function public.admin_package_product_delete(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Only a Green Bergen admin can change the catalogue.');
  end if;
  delete from public.blueprint_package_products where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_package_product_delete(uuid) from public, anon;
grant execute on function public.admin_package_product_delete(uuid) to authenticated, service_role;

-- $750, AND IT IS LABOUR. The included list does not change - it was always
-- the work - so the config label says what the number buys and the charger
-- line stops implying it is in the box.
update public.blueprint_packages
   set base_price_cents = 75000,
       config_label = 'Level 2, within 25 ft of the panel - the labour, the permit and the inspection',
       last_modified_at = now(), last_modified_by = 'claude'
 where code = 'ev_charger';

update public.blueprint_package_items
   set label = 'The charger itself',
       detail = 'Not included - you buy it, and it is yours. There are suggestions below, or bring any Level 2 charger you like; the price does not change.'
 where package_code = 'ev_charger' and label = 'Level 2 charger';

-- The two Shahar sent. Name and store only: the price and the rating are on a
-- page this environment cannot reach, and they are left null rather than
-- guessed. The EVIQO name is his own wording from the example.
insert into public.blueprint_package_products (package_code, name, store, url, sort_order, created_by)
select 'ev_charger', 'EVIQO Level 2 EV', 'Amazon', 'https://www.amazon.com/dp/B0D1XLRC5D', 10, 'claude'
 where not exists (select 1 from public.blueprint_package_products where url like '%B0D1XLRC5D%');

insert into public.blueprint_package_products (package_code, name, store, url, sort_order, created_by)
select 'ev_charger', 'ChargePoint Home EV Charger', 'Amazon', 'https://www.amazon.com/dp/B07WXZDHGV', 20, 'claude'
 where not exists (select 1 from public.blueprint_package_products where url like '%B07WXZDHGV%');

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
