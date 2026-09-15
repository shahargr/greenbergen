-- 144. THE SERVICE AREA IS A RULE, NOT A HINT.
--
-- Alex, a homeowner, is on the system with "20 Oliver St, Mattapoisett Ma
-- 02739". Mattapoisett is in Massachusetts, two hundred miles outside Bergen
-- County, and every package we sell is priced with Bergen contractors who
-- will not be driving there.
--
-- There are three ways to put an address into this system and only two of
-- them were checking:
--
--   /join              JoinForm refuses an outside ZIP and says so kindly.
--   /packages/../book  BookingWizard geocodes and refuses on county.
--   /homes/new         prints the words "Bergen County only" under the box
--                      and passes whatever you typed straight through.
--
-- The third is how Alex got in: addHome -> homeowner_home_add ->
-- create_home_asset, and not one of them looks at where the house is. A rule
-- that lives in two screens out of three is not a rule, it is a habit - and
-- the rulebook has said all along that the rules belong in the database.
--
-- WHY THIS IS "PROVE IT IS OUTSIDE" RATHER THAN "PROVE IT IS INSIDE".
--
-- The obvious test - require a Bergen ZIP - would reject almost every real
-- address on the system today. "52 Ryerson, Closter, NJ", "8 Jason woods rd
-- Closter Nj", "14 larry street, closter", "29 Lexington Ave": people do not
-- type ZIP codes, and four of the live properties have none. Demanding proof
-- of membership would have turned a hole into a wall across our own
-- customers.
--
-- So the test only refuses what it can actually demonstrate is elsewhere, and
-- when it cannot tell, it lets the address through. A false accept is a
-- conversation; a false reject is a lost homeowner.

-- THE AREA ITSELF, in the database rather than only in a TypeScript constant
-- that the database cannot read. Seeded from apps/shared/src/bergen.ts and
-- generated from it, so the two cannot drift by a typo.
create table if not exists public.service_area (
  zip  text primary key,
  town text not null,
  constraint chk_service_area_zip check (zip ~ '^\d{5}$')
);

comment on table public.service_area is
'The ZIP codes Green Bergen serves, each with its town - Bergen County, NJ. Seeded from apps/shared/src/bergen.ts (migration 144) so the screens and the database answer the same question. Expanding the area is an insert here, not a code change.';

alter table public.service_area enable row level security;

drop policy if exists service_area_is_public on public.service_area;
-- The list of towns we serve is a public fact, and the anon surface stays
-- read-only (rulebook 71).
create policy service_area_is_public on public.service_area
  for select using (true);

insert into public.service_area (zip, town) values
  ('07010', 'Cliffside Park'),
  ('07020', 'Edgewater'),
  ('07022', 'Fairview'),
  ('07024', 'Fort Lee'),
  ('07026', 'Garfield'),
  ('07031', 'North Arlington'),
  ('07057', 'Wallington'),
  ('07070', 'Rutherford'),
  ('07071', 'Lyndhurst'),
  ('07072', 'Carlstadt'),
  ('07073', 'East Rutherford'),
  ('07074', 'Moonachie'),
  ('07075', 'Wood-Ridge'),
  ('07401', 'Allendale'),
  ('07407', 'Elmwood Park'),
  ('07410', 'Fair Lawn'),
  ('07417', 'Franklin Lakes'),
  ('07423', 'Ho-Ho-Kus'),
  ('07430', 'Mahwah'),
  ('07432', 'Midland Park'),
  ('07436', 'Oakland'),
  ('07446', 'Ramsey'),
  ('07450', 'Ridgewood'),
  ('07451', 'Ridgewood'),
  ('07452', 'Glen Rock'),
  ('07458', 'Saddle River'),
  ('07463', 'Waldwick'),
  ('07481', 'Wyckoff'),
  ('07495', 'Mahwah'),
  ('07601', 'Hackensack'),
  ('07602', 'Hackensack'),
  ('07603', 'Bogota'),
  ('07604', 'Hasbrouck Heights'),
  ('07605', 'Leonia'),
  ('07606', 'South Hackensack'),
  ('07607', 'Maywood'),
  ('07608', 'Teterboro'),
  ('07620', 'Alpine'),
  ('07621', 'Bergenfield'),
  ('07624', 'Closter'),
  ('07626', 'Cresskill'),
  ('07627', 'Demarest'),
  ('07628', 'Dumont'),
  ('07630', 'Emerson'),
  ('07631', 'Englewood'),
  ('07632', 'Englewood Cliffs'),
  ('07640', 'Harrington Park'),
  ('07641', 'Haworth'),
  ('07642', 'Hillsdale'),
  ('07643', 'Little Ferry'),
  ('07644', 'Lodi'),
  ('07645', 'Montvale'),
  ('07646', 'New Milford'),
  ('07647', 'Northvale'),
  ('07648', 'Norwood'),
  ('07649', 'Oradell'),
  ('07650', 'Palisades Park'),
  ('07652', 'Paramus'),
  ('07653', 'Paramus'),
  ('07656', 'Park Ridge'),
  ('07657', 'Ridgefield'),
  ('07660', 'Ridgefield Park'),
  ('07661', 'River Edge'),
  ('07662', 'Rochelle Park'),
  ('07663', 'Saddle Brook'),
  ('07666', 'Teaneck'),
  ('07670', 'Tenafly'),
  ('07675', 'Westwood'),
  ('07676', 'Township of Washington'),
  ('07677', 'Woodcliff Lake')
on conflict (zip) do update set town = excluded.town;

-- ---------------------------------------------------------------------------
-- THE TEST. Returns a sentence when the address is demonstrably elsewhere,
-- and null when it is not - which includes "I cannot tell", deliberately.
--
-- It reads in the order the evidence is worth trusting:
--   1. a ZIP we serve            -> in, and nothing else matters
--   2. any other 5-digit ZIP     -> out; a ZIP is not ambiguous
--   3. a town we serve           -> in
--   4. a state code that is not NJ -> out
--   5. anything else             -> in, because we cannot prove otherwise
create or replace function public.address_outside_area(p_address text)
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v text := lower(coalesce(p_address, ''));
  v_zip text;
  v_town text;
  v_state text;
begin
  if btrim(v) = '' then return null; end if;

  -- 1 and 2. A five-digit run is a ZIP. ZIP+4 keeps its first five.
  v_zip := substring(v from '\m(\d{5})(?:-\d{4})?\M');
  if v_zip is not null then
    if exists (select 1 from public.service_area a where a.zip = v_zip) then
      return null;
    end if;
    return format('%s is outside Bergen County. We are Bergen-only for now.', v_zip);
  end if;

  -- 3. A town we serve, matched whole rather than as a fragment, so
  -- "Ridgewood Avenue" in some other state does not let an address in.
  -- No escaping needed: the only regex-special character anywhere in the town
  -- list is the hyphen in Ho-Ho-Kus and Wood-Ridge, and a hyphen is literal
  -- outside a character class.
  select a.town into v_town from public.service_area a
   where v ~ ('\m' || lower(a.town) || '\M')
   limit 1;
  if v_town is not null then return null; end if;

  -- 4. A US state code that is not New Jersey. Only the two-letter codes, and
  -- only as whole words - a full state name is far too easy to hit by
  -- accident on a street called Delaware or Virginia.
  select s into v_state from unnest(array[
    'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia',
    'ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nm',
    'ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va',
    'wa','wv','wi','wy','dc']) s
   where v ~ ('\m' || s || '\M')
   limit 1;
  if v_state is not null then
    return format('That address looks like it is in %s. We are Bergen County, New Jersey only for now.',
                  upper(v_state));
  end if;

  -- 5. No ZIP, no town we know, no other state. Not our place to guess.
  return null;
end $function$;

comment on function public.address_outside_area(text) is
'A sentence when a free-text address is demonstrably outside the service area, null when it is not - including when it cannot be told. Deliberately asymmetric: most real addresses on this system carry no ZIP, so demanding proof of membership would reject our own customers. A false accept is a conversation; a false reject is a lost homeowner.';

-- ---------------------------------------------------------------------------
-- THE CHOKEPOINT. Every door that creates a home comes through here - the
-- booking wizard, /homes/new, and anything written later - so this is the one
-- place the rule has to be, and the only place it can be relied on.
--
-- A superadmin is not stopped. Expanding into a new town starts with somebody
-- at Green Bergen putting a real address in before the ZIP list catches up,
-- and a rule that blocks its own operators gets worked around with the
-- service key, which is the thing the rulebook forbids.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_home_asset';

  out_ := replace(src,
    E'  if v_town is null then\n',
    E'  if not public.is_superadmin() then\n'
    || E'    declare v_why text := public.address_outside_area(v_addr);\n'
    || E'    begin\n'
    || E'      if v_why is not null then\n'
    || E'        return jsonb_build_object(''ok'', false, ''code'', ''OUTSIDE_AREA'', ''reason'',\n'
    || E'          v_why || '' Tell us where you are and we will let you know when we reach you.'');\n'
    || E'      end if;\n'
    || E'    end;\n'
    || E'  end if;\n'
    || E'\n'
    || E'  if v_town is null then\n');

  if out_ = src then
    raise exception 'create_home_asset has drifted - the town fallback is not where it was.';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
