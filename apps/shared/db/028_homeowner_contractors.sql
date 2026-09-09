-- 028 - the contractor directory, for homeowners.
--
-- Capability 5 of the six the portal still held (docs/PORTAL-DEPRECATION.md).
-- The portal's portal_contractor() is a GC's view: money, bids, contracts,
-- phone, address - scoped to projects the caller runs. A homeowner needs a
-- different thing: WHO IS IN THE COMMUNITY, what they do, where they work,
-- how they have done, and whether Green Bergen has looked at them.
--
-- WHO IS LISTED: exactly the people an offer can reach - approved, with an
-- active account (the homeowner_trade_covered predicate, migration 023).
-- Listing anyone else would show a homeowner a name they cannot book.
--
-- WHAT IS NOT: phone, email, street address. The community price and the
-- match ARE the product; a directory that hands out phone numbers turns it
-- back into a lead list, and it is the thing contractors were promised they
-- would not be one of (contractor app landing: "you are never one of six
-- people called about the same boiler"). Town and radius say where they
-- work without saying where they live. If that is ever wrong, it is one
-- column to add - the function is the only reader.
--
-- Members only (authenticated). A stranger browsing the catalogue does not
-- need the roster, and the roster is not marketing.
create or replace function public.homeowner_contractors(p_contact uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.jobs_done desc, x.approved_at asc, x.name), '[]'::jsonb)
  from (
    select ct.id,
           coalesce(ct.person_name, ct.name)       as name,
           co.company_name                          as company,
           co.website                               as website,
           co.service_zip                           as service_zip,
           co.service_radius_miles                  as service_radius_miles,
           coalesce(co.serves_adjacent_states,false) as serves_adjacent_states,
           ca.decided_at                            as approved_at,
           (select coalesce(jsonb_agg(jsonb_build_object('trade', t.trade, 'licence', tr.license_label) order by t.trade), '[]'::jsonb)
              from (select r.trade from public.contact_trade_roles r where r.contact_id = ct.id
                    union select r.trade from public.company_trade_roles r where r.company_id = ct.company_id) t
              join public.trades tr on tr.trade = t.trade)                                   as trades,
           case when co.id is null then null else public.contractor_rating(co.id) end          as rating,
           (select count(*) from public.project_bookings b
             where b.contractor_contact_id = ct.id and (b.state = 'done' or b.done_at is not null)) as jobs_done,
           (select count(*) from public.project_bookings b
             where b.contractor_contact_id = ct.id and b.state = 'accepted')                    as jobs_live,
           -- What a member can actually book from this person: the priced
           -- packages in the trades they carry.
           (select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'title', p.tile_title, 'line2', p.tile_line2, 'illustration', p.illustration) order by p.sort_order), '[]'::jsonb)
              from public.blueprint_packages p
             where p.is_active and p.availability = 'priced'
               and p.trade in (select r.trade from public.contact_trade_roles r where r.contact_id = ct.id
                               union select r.trade from public.company_trade_roles r where r.company_id = ct.company_id)) as packages
      from public.contacts ct
      join public.app_users u on u.contact_id = ct.id and u.is_active
      join public.contractor_approvals ca on ca.contact_id = ct.id and ca.status = 'approved'
      left join public.companies co on co.id = ct.company_id
     where ct.disabled_at is null
       and (p_contact is null or ct.id = p_contact)
  ) x;
$$;

comment on function public.homeowner_contractors(uuid) is
  'The community roster as a homeowner sees it: approved contractors with an active account (the same set an offer can reach), their trades, where they work, their rating and their record here. Deliberately no phone, email or street address - the match is the product. Members only.';

revoke all on function public.homeowner_contractors(uuid) from public, anon;
grant execute on function public.homeowner_contractors(uuid) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
