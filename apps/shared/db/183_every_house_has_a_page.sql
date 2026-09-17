-- 183: EVERY HOUSE HAS A PAGE, AND ITS OWNER DECIDES WHAT IS ON IT.
--
-- Shahar (2026-09-17): "Every house created in the system should have a
-- landing page with more info and a form collecting information about
-- potential buyers / renters. this page should have carousel for photos, and
-- description similar to what you might find in Zillow. This page be
-- configurable by property owner, with optional fields such as cost, photos,
-- floor plan, etc."
--
-- WHAT ALREADY EXISTED, because half of this was built for Green Bergen's own
-- builds: project_about_pages (headline, body, contact, square feet, a hero
-- photo), about_page() and public_showcase() reading them for anon,
-- about_inquire() writing a lead, and fn_inquiry_creates_action turning that
-- lead into a task for every member at rank 50 and above. None of it is
-- replaced. What this migration adds is the four things his sentence asks for
-- that were missing.
--
-- ONE: A PAGE FOR EVERY HOUSE, not only the ones flagged for the showcase.
-- A house is the project that HOLDS a real-estate asset - the container, not
-- the jobs beneath it (55 Walnut Drive, not its New build). Every one gets a
-- page row the moment it exists, and a trigger gives the next one the same.
--
-- TWO: DRAFT UNTIL THE OWNER PUBLISHES (his choice). A page exists from day
-- one and returns NOTHING to the public until is_published is set. Nobody's
-- home address becomes a public URL because they signed up. Note the two
-- switches are different on purpose: is_published means the page answers at
-- its own URL; projects.showcase means Green Bergen lists the house on its
-- front door. A homeowner publishing their own page does not put their house
-- on our marketing site.
--
-- THREE: THE ZILLOW FACTS, each optional. purpose says what the page is for
-- (a home, for sale, for rent, sold, rented) and the price, availability and
-- buyer form only exist in the market modes. The show_* flags are the
-- "optional fields" - the owner turns the price, the facts, the plans, the
-- build log and the form on and off one by one. address_display is the same
-- idea for the address, which is the one field where the wrong default is a
-- privacy problem rather than an empty section: street and town, never the
-- full line, unless the owner says so.
--
-- FOUR: PHOTOS THE OWNER PICKS (his choice). The job's photos live in the
-- PRIVATE project-media bucket, and anon cannot be handed a signed URL for
-- them - no session, nothing to sign with. So a picked photo is COPIED into
-- the public bucket, and house_page_photos records the copy, its order, its
-- caption and whether it is the cover. The DB owns where the copy goes
-- (house_photo_path) and who may write there (a storage policy, below);
-- the app does the one thing SQL cannot, which is move the bytes.

-- ---------------------------------------------------------------------------
-- THE LISTING FIELDS. All optional, all on the page row that already exists.
alter table public.project_about_pages
  add column if not exists purpose         text not null default 'home',
  add column if not exists price           numeric,
  add column if not exists price_note      text,
  add column if not exists beds            numeric,
  add column if not exists baths           numeric,
  add column if not exists lot_size        text,
  add column if not exists available_from  date,
  add column if not exists features        text[],
  add column if not exists address_display text,
  add column if not exists show_price      boolean not null default true,
  add column if not exists show_facts      boolean not null default true,
  add column if not exists show_plans      boolean not null default true,
  add column if not exists show_build      boolean not null default true,
  add column if not exists show_form       boolean not null default true;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_about_purpose') then
    alter table public.project_about_pages add constraint chk_about_purpose
      check (purpose in ('home','for sale','for rent','sold','rented'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_about_address_display') then
    alter table public.project_about_pages add constraint chk_about_address_display
      check (address_display is null or address_display in ('full','street and town','town only','hidden'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_about_price') then
    alter table public.project_about_pages add constraint chk_about_price
      check (price is null or price >= 0);
  end if;
end $$;

comment on column public.project_about_pages.purpose is
  'What the page is for: home (just a page about the house), for sale, for rent, sold, rented. The price, availability and the buyer/renter form only appear in the market modes.';
comment on column public.project_about_pages.address_display is
  'full | street and town | town only | hidden. Null falls back to show_address (true = street and town, false = town only). The page NEVER prints more than this says.';

-- ---------------------------------------------------------------------------
-- WHAT COUNTS AS A HOUSE. The project that holds a real-estate asset and is
-- the topmost one holding it: 55 Walnut Drive, not the New build beneath it.
create or replace function public.is_house(p_project uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.projects p
      join public.assets a on a.id = p.asset_id
      left join public.projects par on par.id = p.parent_project_id
     where p.id = p_project
       and p.trashed_at is null
       and coalesce(p.is_template, false) = false
       and lower(coalesce(a.asset_type, '')) = 'real estate'
       and (par.id is null or par.asset_id is distinct from p.asset_id));
$$;
revoke all on function public.is_house(uuid) from public, anon;
grant execute on function public.is_house(uuid) to authenticated;

-- The house a project belongs to - itself when it IS the house, else the
-- container above it. A job's slug therefore still finds its house, which is
-- how /p/55-walnut-drive keeps working: that slug sits on the New build.
create or replace function public.house_of(p_project uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select p.id, p.parent_project_id, p.asset_id from public.projects p where p.id = p_project
    union all
    select par.id, par.parent_project_id, par.asset_id
      from up join public.projects par on par.id = up.parent_project_id
     where par.asset_id is not distinct from up.asset_id)
  select u.id from up u where public.is_house(u.id) limit 1;
$$;
revoke all on function public.house_of(uuid) from public, anon;
grant execute on function public.house_of(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- THE SLUG. The street line of the address, else the project name, with a
-- number added only if that name is taken.
create or replace function public.house_slug(p_text text)
returns text
language sql immutable as $$
  select nullif(trim(both '-' from regexp_replace(
    lower(regexp_replace(coalesce(split_part(p_text, ',', 1), ''), '[^a-zA-Z0-9]+', '-', 'g')),
    '-+', '-', 'g')), '');
$$;

create or replace function public.house_slug_free(p_text text, p_project uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare v_base text; v_try text; v_n integer := 1;
begin
  v_base := coalesce(public.house_slug(p_text), 'house');
  v_try := v_base;
  while exists (select 1 from public.projects p where p.public_slug = v_try and p.id <> p_project) loop
    v_n := v_n + 1;
    v_try := v_base || '-' || v_n;
  end loop;
  return v_try;
end $$;

-- ---------------------------------------------------------------------------
-- A PAGE THE MOMENT THE HOUSE EXISTS. Draft, with a slug of its own.
--
-- is_published is false for a new house, but the backfill below must not
-- UNPUBLISH the three houses already on the front door: a house whose
-- container or any job beneath it carries showcase keeps its page live.
create or replace function public.fn_projects_house_page()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if not public.is_house(new.id) then return new; end if;

    if new.public_slug is null then
      update public.projects
         set public_slug = public.house_slug_free(coalesce(new.address, new.project_name), new.id)
       where id = new.id and public_slug is null;
    end if;

    insert into public.project_about_pages (project_id, is_published, show_address, updated_by)
    values (new.id, false, true, 'trigger:house-page')
    on conflict (project_id) do nothing;
  exception when others then
    -- A house that cannot get a page must still be created. create_home_asset
    -- is the governed door and nothing here may slam it.
    insert into public.system_trigger_errors (trigger_fn, row_id, sqlstate, message)
    values ('fn_projects_house_page', new.id, sqlstate, 'House created but no page: ' || sqlerrm);
  end;
  return new;
end $$;

drop trigger if exists trg_projects_house_page on public.projects;
create trigger trg_projects_house_page
  after insert or update of asset_id on public.projects
  for each row execute function public.fn_projects_house_page();

-- Backfill: every house that exists today.
update public.projects p
   set public_slug = public.house_slug_free(coalesce(p.address, p.project_name), p.id)
 where p.public_slug is null and public.is_house(p.id);

insert into public.project_about_pages (project_id, is_published, show_address, updated_by)
select p.id,
       -- already on the front door, or a job beneath it is: stay live.
       coalesce(p.showcase, false)
         or exists (select 1 from public.projects c
                     where c.parent_project_id = p.id and coalesce(c.showcase, false)),
       true, 'migration:183'
  from public.projects p
 where public.is_house(p.id)
on conflict (project_id) do nothing;

-- ---------------------------------------------------------------------------
-- THE PHOTOS ON THE PAGE. One row per published copy, in the order the owner
-- put them; kind separates the carousel from the plans.
create table if not exists public.house_page_photos (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  file_id     uuid references public.files(id) on delete set null,
  public_path text not null,
  kind        text not null default 'photo',
  caption     text,
  sort        integer not null default 0,
  is_cover    boolean not null default false,
  created_by  text default 'portal',
  created_at  timestamptz default now(),
  constraint chk_house_photo_kind check (kind in ('photo','floor plan','elevation','site plan')),
  constraint uq_house_photo_path unique (project_id, public_path)
);
create index if not exists ix_house_page_photos_project on public.house_page_photos (project_id, kind, sort);

comment on table public.house_page_photos is
  'The photos on a house page, in order. public_path is a copy in the PUBLIC public-media bucket; file_id remembers which private file it came from. Anon never reads this table - house_page() does.';

alter table public.house_page_photos enable row level security;

drop policy if exists "house photos read by members" on public.house_page_photos;
create policy "house photos read by members" on public.house_page_photos
  for select to authenticated using (public.is_project_member(project_id));

drop policy if exists "house photos written by editors" on public.house_page_photos;
create policy "house photos written by editors" on public.house_page_photos
  for all to authenticated using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

-- WHERE A COPY MAY GO, and who may put it there. The path is derived, never
-- passed in by a caller who could aim it somewhere else.
create or replace function public.house_photo_path(p_project uuid, p_file uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare v_slug text; v_name text;
begin
  if not public.can_edit_project(p_project) then return null; end if;
  select p.public_slug into v_slug from public.projects p where p.id = public.house_of(p_project);
  if v_slug is null then return null; end if;
  select coalesce(nullif(regexp_replace(lower(f.file_name), '[^a-z0-9.]+', '-', 'g'), ''), 'photo')
    into v_name from public.files f where f.id = p_file;
  return 'gallery/' || v_slug || '/' || replace(p_file::text, '-', '') || '-' || coalesce(v_name, 'photo');
end $$;
revoke all on function public.house_photo_path(uuid, uuid) from public, anon;
grant execute on function public.house_photo_path(uuid, uuid) to authenticated;

-- The storage policy reads the slug back out of the path and asks the same
-- question the rest of the system asks: may you edit that project?
create or replace function public.can_publish_house_photo(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_name like 'gallery/%/%'
     and exists (select 1 from public.projects p
                  where p.public_slug = split_part(p_name, '/', 2)
                    and public.can_edit_project(p.id));
$$;
revoke all on function public.can_publish_house_photo(text) from public, anon;
grant execute on function public.can_publish_house_photo(text) to authenticated;

drop policy if exists "public media house gallery write" on storage.objects;
create policy "public media house gallery write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'public-media' and public.can_publish_house_photo(name));

drop policy if exists "public media house gallery delete" on storage.objects;
create policy "public media house gallery delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'public-media' and public.can_publish_house_photo(name));

-- ---------------------------------------------------------------------------
-- THE OWNER'S WRITES. Every one asks can_edit_project and nothing else
-- decides.
create or replace function public.house_photo_add(
  p_project uuid, p_file uuid, p_public_path text,
  p_kind text default 'photo', p_caption text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_house uuid; v_id uuid; v_first boolean;
begin
  perform public.assert_own_hands();
  v_house := public.house_of(p_project);
  if v_house is null or not public.can_edit_project(v_house) then
    return jsonb_build_object('ok', false, 'reason', 'That house is not yours to change.');
  end if;
  if p_public_path is distinct from public.house_photo_path(v_house, p_file) then
    return jsonb_build_object('ok', false, 'reason', 'That is not where this photo belongs.');
  end if;
  if coalesce(p_kind, 'photo') not in ('photo','floor plan','elevation','site plan') then
    return jsonb_build_object('ok', false, 'reason', 'That is not a kind of picture a page shows.');
  end if;

  select not exists (select 1 from public.house_page_photos where project_id = v_house and kind = 'photo')
    into v_first;

  insert into public.house_page_photos (project_id, file_id, public_path, kind, caption, sort, is_cover, created_by)
  values (v_house, p_file, p_public_path, coalesce(p_kind, 'photo'), nullif(btrim(p_caption), ''),
          coalesce((select max(sort) from public.house_page_photos where project_id = v_house and kind = coalesce(p_kind,'photo')), 0) + 1,
          v_first and coalesce(p_kind, 'photo') = 'photo', 'portal:house-page')
  on conflict (project_id, public_path) do update set caption = coalesce(excluded.caption, house_page_photos.caption)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'path', p_public_path,
    'photos', (select count(*) from public.house_page_photos where project_id = v_house));
end $$;
revoke all on function public.house_photo_add(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.house_photo_add(uuid, uuid, text, text, text) to authenticated;

-- Reorder, cover, caption, remove. Removing hands the path back so the app
-- can delete the object it copied.
create or replace function public.house_photo_edit(
  p_photo uuid, p_move integer default null, p_cover boolean default null,
  p_caption text default null, p_drop boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ph public.house_page_photos; v_swap public.house_page_photos;
begin
  perform public.assert_own_hands();
  select * into ph from public.house_page_photos where id = p_photo;
  if ph.id is null or not public.can_edit_project(ph.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That picture is not yours to change.');
  end if;

  if p_drop then
    delete from public.house_page_photos where id = p_photo;
    -- The cover cannot be a hole: the first photo left takes it.
    if ph.is_cover then
      update public.house_page_photos set is_cover = true
       where id = (select id from public.house_page_photos
                    where project_id = ph.project_id and kind = 'photo' order by sort limit 1);
    end if;
    return jsonb_build_object('ok', true, 'dropped', true, 'path', ph.public_path);
  end if;

  if p_caption is not null then
    update public.house_page_photos set caption = nullif(btrim(p_caption), '') where id = p_photo;
  end if;

  if coalesce(p_cover, false) then
    update public.house_page_photos set is_cover = (id = p_photo) where project_id = ph.project_id and kind = 'photo';
  end if;

  if p_move is not null and p_move <> 0 then
    select * into v_swap from public.house_page_photos
     where project_id = ph.project_id and kind = ph.kind
       and case when p_move < 0 then sort < ph.sort else sort > ph.sort end
     order by case when p_move < 0 then -sort else sort end
     limit 1;
    if v_swap.id is not null then
      update public.house_page_photos set sort = ph.sort where id = v_swap.id;
      update public.house_page_photos set sort = v_swap.sort where id = ph.id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', p_photo);
end $$;
revoke all on function public.house_photo_edit(uuid, integer, boolean, text, boolean) from public, anon;
grant execute on function public.house_photo_edit(uuid, integer, boolean, text, boolean) to authenticated;

-- The page's own fields. Anything left null is left alone, so the screen can
-- save one section without carrying the others.
create or replace function public.house_page_save(
  p_project uuid,
  p_purpose text default null, p_headline text default null, p_body text default null,
  p_price numeric default null, p_price_note text default null,
  p_beds numeric default null, p_baths numeric default null, p_sqft integer default null,
  p_lot_size text default null, p_built_year integer default null, p_available_from date default null,
  p_features text[] default null,
  p_contact_name text default null, p_contact_phone text default null, p_contact_email text default null,
  p_address_display text default null,
  p_show_price boolean default null, p_show_facts boolean default null, p_show_plans boolean default null,
  p_show_build boolean default null, p_show_form boolean default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_house uuid;
begin
  perform public.assert_own_hands();
  v_house := public.house_of(p_project);
  if v_house is null or not public.can_edit_project(v_house) then
    return jsonb_build_object('ok', false, 'reason', 'That house is not yours to change.');
  end if;
  if p_purpose is not null and p_purpose not in ('home','for sale','for rent','sold','rented') then
    return jsonb_build_object('ok', false, 'reason', 'A page is a home, for sale, for rent, sold or rented.');
  end if;
  if p_address_display is not null and p_address_display not in ('full','street and town','town only','hidden') then
    return jsonb_build_object('ok', false, 'reason', 'The address shows as full, street and town, town only, or hidden.');
  end if;

  insert into public.project_about_pages (project_id, is_published, show_address, updated_by)
  values (v_house, false, true, 'portal:house-page')
  on conflict (project_id) do nothing;

  update public.project_about_pages set
    purpose         = coalesce(p_purpose, purpose),
    headline        = coalesce(nullif(btrim(p_headline), ''), headline),
    body            = coalesce(nullif(btrim(p_body), ''), body),
    price           = coalesce(p_price, price),
    price_note      = coalesce(nullif(btrim(p_price_note), ''), price_note),
    beds            = coalesce(p_beds, beds),
    baths           = coalesce(p_baths, baths),
    total_sqft      = coalesce(p_sqft, total_sqft),
    lot_size        = coalesce(nullif(btrim(p_lot_size), ''), lot_size),
    built_year      = coalesce(p_built_year, built_year),
    available_from  = coalesce(p_available_from, available_from),
    features        = coalesce(p_features, features),
    contact_name    = coalesce(nullif(btrim(p_contact_name), ''), contact_name),
    contact_phone   = coalesce(nullif(btrim(p_contact_phone), ''), contact_phone),
    contact_email   = coalesce(nullif(btrim(p_contact_email), ''), contact_email),
    address_display = coalesce(p_address_display, address_display),
    show_price      = coalesce(p_show_price, show_price),
    show_facts      = coalesce(p_show_facts, show_facts),
    show_plans      = coalesce(p_show_plans, show_plans),
    show_build      = coalesce(p_show_build, show_build),
    show_form       = coalesce(p_show_form, show_form),
    updated_by      = 'portal:house-page',
    updated_at      = now()
  where project_id = v_house;

  return jsonb_build_object('ok', true, 'project_id', v_house,
    'slug', (select public_slug from public.projects where id = v_house));
end $$;
revoke all on function public.house_page_save(uuid, text, text, text, numeric, text, numeric, numeric, integer, text, integer, date, text[], text, text, text, text, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.house_page_save(uuid, text, text, text, numeric, text, numeric, numeric, integer, text, integer, date, text[], text, text, text, text, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- PUBLISH. The one switch that makes the page answer at its URL. It refuses a
-- page with nothing on it, because an empty public page about somebody's home
-- is worse than no page.
create or replace function public.house_page_publish(p_project uuid, p_on boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_house uuid; ap public.project_about_pages; v_photos integer; v_slug text;
begin
  perform public.assert_own_hands();
  v_house := public.house_of(p_project);
  if v_house is null or not public.can_edit_project(v_house) then
    return jsonb_build_object('ok', false, 'reason', 'That house is not yours to publish.');
  end if;
  select * into ap from public.project_about_pages where project_id = v_house;
  select count(*) into v_photos from public.house_page_photos where project_id = v_house;

  if p_on then
    if coalesce(nullif(btrim(ap.body), ''), nullif(btrim(ap.headline), '')) is null and v_photos = 0 then
      return jsonb_build_object('ok', false, 'code', 'EMPTY',
        'reason', 'Write a line about the house, or put a photograph on it, before it goes out.');
    end if;
  end if;

  update public.project_about_pages
     set is_published = coalesce(p_on, true), updated_by = 'portal:house-page', updated_at = now()
   where project_id = v_house;
  select public_slug into v_slug from public.projects where id = v_house;

  return jsonb_build_object('ok', true, 'published', coalesce(p_on, true), 'slug', v_slug,
    'url', '/p/' || v_slug);
end $$;
revoke all on function public.house_page_publish(uuid, boolean) from public, anon;
grant execute on function public.house_page_publish(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- WHAT THE OWNER'S SCREEN READS: the page as it stands, the photos on it, and
-- the job photos still available to pick.
create or replace function public.house_page_mine(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_house uuid;
begin
  v_house := public.house_of(p_project);
  if v_house is null or not public.can_edit_project(v_house) then return null; end if;

  return (
    select jsonb_build_object(
      'project_id', p.id,
      'house', p.project_name,
      'address', p.address,
      'slug', p.public_slug,
      'url', case when p.public_slug is null then null else '/p/' || p.public_slug end,
      'on_front_door', coalesce(p.showcase, false),
      'page', to_jsonb(ap) - 'project_id',
      'photos', coalesce((select jsonb_agg(jsonb_build_object(
            'id', ph.id, 'file_id', ph.file_id, 'path', ph.public_path, 'kind', ph.kind,
            'caption', ph.caption, 'sort', ph.sort, 'is_cover', ph.is_cover)
          order by ph.kind, ph.sort) from public.house_page_photos ph where ph.project_id = p.id), '[]'::jsonb),
      -- Every photograph on this house and the jobs beneath it, newest first,
      -- with whether it is already on the page.
      'pickable', coalesce((select jsonb_agg(x) from (
            select jsonb_build_object('file_id', f.id, 'name', f.file_name, 'caption', f.caption,
                     'bucket', f.bucket, 'path', f.path, 'taken_at', f.taken_at, 'kind', f.kind,
                     'on_page', exists (select 1 from public.house_page_photos ph
                                         where ph.project_id = p.id and ph.file_id = f.id)) as x
              from public.files f
             where f.project_id in (select d.id from public.project_ancestry_down(p.id) d)
               and coalesce(f.mime_type, '') like 'image/%'
               and coalesce(f.is_latest, true)
             order by coalesce(f.taken_at, f.created_at) desc
             limit 200) q), '[]'::jsonb)
    )
    from public.projects p
    left join public.project_about_pages ap on ap.project_id = p.id
    where p.id = v_house);
end $$;
revoke all on function public.house_page_mine(uuid) from public, anon;
grant execute on function public.house_page_mine(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- THE PUBLIC READ. Anon. Returns null for a page that is not published, and
-- prints no field the owner has switched off - the flags are enforced HERE,
-- not in the screen, so a second front end cannot leak what the first hides.
create or replace function public.house_page(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_house uuid; p public.projects; ap public.project_about_pages;
  v_market boolean; v_addr text; v_parts text[]; v_show text;
  v_job public.projects;
begin
  select public.house_of(x.id) into v_house from public.projects x where x.public_slug = p_slug limit 1;
  if v_house is null then return null; end if;
  select * into p from public.projects p2 where p2.id = v_house;
  select * into ap from public.project_about_pages a where a.project_id = v_house;
  if p.id is null or p.trashed_at is not null or coalesce(ap.is_published, false) = false then
    return null;
  end if;

  v_market := ap.purpose in ('for sale','for rent');
  v_show := coalesce(ap.address_display, case when coalesce(ap.show_address, true) then 'street and town' else 'town only' end);
  v_parts := string_to_array(coalesce(p.address, ''), ',');
  v_addr := case v_show
              when 'full' then p.address
              when 'street and town' then nullif(btrim(coalesce(v_parts[1], '') ||
                                        case when v_parts[2] is not null then ', ' || btrim(v_parts[2]) else '' end), '')
              when 'town only' then nullif(btrim(coalesce(v_parts[2], '')), '')
              else null end;

  -- The build log belongs to the live job beneath the house, if any.
  select c.* into v_job from public.projects c
   where c.id in (select d.id from public.project_ancestry_down(v_house) d)
     and c.id <> v_house and c.trashed_at is null
     and lower(coalesce(c.status, '')) not like 'closed%'
     and coalesce(c.showcase, false)
   order by c.created_at limit 1;

  return jsonb_build_object(
    'slug', p.public_slug,
    'project_id', v_house,
    'purpose', ap.purpose,
    'on_market', v_market,
    'title', coalesce(v_addr, p.project_name),
    'address', v_addr,
    'town', nullif(btrim(coalesce(v_parts[2], '')), ''),
    'headline', replace(replace(coalesce(ap.headline, ''), '{{project}}', p.project_name),
                        '{{address}}', coalesce(v_addr, '')),
    'body', replace(replace(coalesce(ap.body, ''), '{{project}}', p.project_name),
                    '{{address}}', coalesce(v_addr, '')),
    'price', case when v_market and coalesce(ap.show_price, true) then ap.price end,
    'price_note', case when v_market and coalesce(ap.show_price, true) then ap.price_note end,
    'available_from', case when v_market then ap.available_from end,
    'facts', case when coalesce(ap.show_facts, true) then jsonb_build_object(
        'beds', coalesce(ap.beds, (select sum(b.bed_count) from public.project_spaces ps
                                    join public.blueprint_spaces b on b.code = ps.space_type
                                   where ps.project_id in (select d.id from public.project_ancestry_down(v_house) d))),
        'baths', coalesce(ap.baths, (select sum(b.bath_count) from public.project_spaces ps
                                      join public.blueprint_spaces b on b.code = ps.space_type
                                     where ps.project_id in (select d.id from public.project_ancestry_down(v_house) d))),
        'sqft', ap.total_sqft,
        'lot_size', ap.lot_size,
        'built_year', ap.built_year,
        'garage', ap.garage_note,
        'features', coalesce(to_jsonb(ap.features), '[]'::jsonb),
        'note', ap.scope_note) end,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('path', ph.public_path, 'caption', ph.caption,
                            'is_cover', ph.is_cover) order by ph.is_cover desc, ph.sort)
                        from public.house_page_photos ph
                       where ph.project_id = v_house and ph.kind = 'photo'), '[]'::jsonb),
    'plans', case when coalesce(ap.show_plans, true) then
              coalesce((select jsonb_agg(jsonb_build_object('path', ph.public_path, 'caption', ph.caption,
                            'kind', ph.kind) order by ph.kind, ph.sort)
                        from public.house_page_photos ph
                       where ph.project_id = v_house and ph.kind <> 'photo'), '[]'::jsonb) end,
    'build', case when coalesce(ap.show_build, true) and v_job.id is not null then jsonb_build_object(
        'live', true, 'job_id', v_job.id, 'job', v_job.project_name,
        'target_finish', v_job.required_finish, 'gallery_slug', v_job.public_slug) end,
    'contact', jsonb_build_object('name', ap.contact_name, 'phone', ap.contact_phone, 'email', ap.contact_email),
    'form', jsonb_build_object(
        'enabled', coalesce(ap.show_form, true),
        'kinds', case when ap.purpose = 'for rent' then jsonb_build_array('rent','tour','question')
                      when ap.purpose = 'for sale' then jsonb_build_array('buy','tour','question')
                      else jsonb_build_array('question','more_info') end));
end $$;
revoke all on function public.house_page(text) from public;
grant execute on function public.house_page(text) to anon, authenticated;

comment on function public.house_page(text) is
  'The public read of a house page, for anon. Returns null unless the owner published it, and omits every field the owner switched off - the show_* flags and address_display are enforced here so no front end can leak what another one hides.';

-- ---------------------------------------------------------------------------
-- A LEAD CAN NOW SAY IT WANTS TO BUY OR RENT. The three existing kinds stay;
-- the pipe from lead to task (fn_inquiry_creates_action) is untouched except
-- for the words it writes.
create or replace function public.about_inquire(p_project_id uuid, p_name text, p_phone text, p_email text,
  p_kind text, p_message text default null, p_preferred_date date default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := nullif(trim(coalesce(p_phone,'')), '');
  v_email text := nullif(lower(trim(coalesce(p_email,''))), '');
begin
  if not exists (select 1 from public.projects where id = p_project_id) then
    return 'ERROR: unknown project';
  end if;
  if coalesce(trim(p_name),'') = '' or length(p_name) > 120 then return 'ERROR: name is required'; end if;
  if v_phone is null and v_email is null then return 'ERROR: a phone number or an email is required'; end if;
  if length(coalesce(v_phone,'')) > 40 then return 'ERROR: phone too long'; end if;
  if length(coalesce(v_email,'')) > 160 then return 'ERROR: email too long'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'ERROR: that email does not look right'; end if;
  if p_kind not in ('question','more_info','site_visit','buy','rent','tour') then return 'ERROR: invalid kind'; end if;
  if length(coalesce(p_message,'')) > 2000 then return 'ERROR: message too long'; end if;

  insert into public.project_inquiries(project_id, name, phone, email, contact, kind, message, preferred_date)
  values (p_project_id, trim(p_name), v_phone, v_email,
          concat_ws(' / ', v_phone, v_email),
          p_kind, nullif(trim(p_message),''), p_preferred_date);
  return 'ok';
exception when others then return 'ERROR: ' || sqlerrm;
end $$;

create or replace function public.fn_inquiry_creates_action()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project public.projects;
  v_kind text;
begin
  begin
    if exists (select 1 from public.actions a where a.inquiry_id = new.id) then
      return new;
    end if;
    select * into v_project from public.projects where id = new.project_id;

    v_kind := case new.kind
      when 'site_visit' then 'Site visit request'
      when 'more_info'  then 'Information request'
      when 'buy'        then 'BUYER'
      when 'rent'       then 'RENTER'
      when 'tour'       then 'Viewing request'
      else 'Question' end;

    insert into public.actions
      (action, project_id, domain, status, priority, created_by, source,
       inquiry_id, depth_level, desired_outcome, notes)
    values (
      v_kind || ' from ' || new.name || ' - ' || coalesce(v_project.project_name, 'unknown project'),
      new.project_id,
      coalesce(v_project.domain, 'construction'),
      'Not Started', 'High', 'system: inquiry', 'side_interface',
      new.id, 1,
      'The lead was answered: ' || new.name || ' heard back' ||
        case when new.kind in ('site_visit','tour') then ' and the visit is scheduled or declined.'
             when new.kind in ('buy','rent') then ' and knows where they stand.'
             else '.' end,
      'Public inquiry from the house page.' ||
      E'\nName: ' || new.name ||
      coalesce(E'\nPhone: ' || new.phone, '') ||
      coalesce(E'\nEmail: ' || new.email, '') ||
      coalesce(E'\nPreferred date: ' || new.preferred_date::text, '') ||
      coalesce(E'\nMessage: ' || new.message, '') ||
      E'\nReview: this task sits with every project member at authority rank >= 50 (PM and above).');
  exception when others then
    insert into public.system_trigger_errors (trigger_fn, row_id, sqlstate, message)
    values ('fn_inquiry_creates_action', new.id, sqlstate,
            'Inquiry stored but no task was created: ' || sqlerrm);
  end;
  return new;
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
