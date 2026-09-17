-- 161. THE PHONE BOOK OF A JOB.
--
-- Shahar (2026-09-17), on the notebook sheet: "remove order and book, but add
-- phone book for project."
--
-- Standing on a site, the question is "what is the plumber's number" and the
-- answer was four screens away - the trade, its contract, the party, the
-- contact. Nothing in the database answered it in one read for somebody who
-- is not the owner: portal_my_contacts is owner/manager only and reads seats
-- alone, project_people reads seats alone and carries no phone.
--
-- One function, one read: everybody with a reason to be rung about this job.
--   * the SEATS on the job and on the projects above it (the owner sits on
--     the property, not on each job beneath it), through project_ancestry;
--   * the PARTIES to its contracts - the contractor and the counterparty -
--     because a lumber yard's rep has no seat and is exactly who you ring.
-- Each once, with phone, second phone, email, company, the seat they hold,
-- and the trade they work on this job.
--
-- WHO SEES WHOM follows project_people: a member sees everybody; a
-- contract-bounded member (a trade on the job) sees the people running it
-- (rank 50 and up), the parties to their own contracts, and themselves. The
-- address rule (008) is untouched - this returns people, never the address.
-- Anon is revoked (rulebook 71).

create or replace function public.portal_project_phone_book(p_project uuid)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  with fam as (
    select project_id as id from public.project_ancestry(p_project)
    union select p_project
  ),
  bounded as (select public.is_contract_bounded_member(p_project) as b),
  mine as (select contract_id from public.my_contract_ids(p_project)),
  me as (select public.my_contact_id() as id),
  seats as (
    select c.id as contact_id,
           coalesce(pm.project_role, pm.role) as seat,
           coalesce(r.authority_rank, 0) as rank,
           pm.contract_id,
           (pm.project_id = p_project) as here
      from public.project_members pm
      left join public.project_roles r on r.role = pm.project_role
      join public.contacts c
        on c.id = coalesce(pm.contact_id,
                           (select u.contact_id from public.app_users u where u.id = pm.app_user_id))
     where pm.project_id in (select id from fam)
       and pm.status = 'active'
  ),
  parties as (
    select x.contact_id, ct.trade, ct.id as contract_id
      from public.contracts ct
      cross join lateral (values (ct.contractor_id), (ct.counterparty_contact_id)) x(contact_id)
     where ct.project_id in (select id from fam)
       and x.contact_id is not null
       and lower(ct.status) not in ('cancelled', 'void', 'placeholder')
       and public.can_see_contract(ct.id)
  ),
  ppl as (
    select contact_id from seats
    union
    select contact_id from parties
  ),
  rows_ as (
    select c.id,
           coalesce(c.person_name, c.name) as name,
           co.company_name as company,
           c.phone, c.phone_2, c.email_a as email,
           (select s.seat from seats s where s.contact_id = c.id
             order by s.here desc, s.rank desc limit 1) as seat,
           coalesce((select s.rank from seats s where s.contact_id = c.id
                      order by s.rank desc limit 1), 0) as rank,
           coalesce((select p.trade from parties p where p.contact_id = c.id and p.trade is not null limit 1),
                    (select r.trade from public.contact_trade_roles r where r.contact_id = c.id
                      order by r.created_at limit 1)) as trade,
           (c.id = (select id from me)) as me_
      from ppl
      join public.contacts c on c.id = ppl.contact_id
      left join public.companies co on co.id = c.company_id
     where c.disabled_at is null
       and (
         not (select b from bounded)
         or c.id = (select id from me)
         or exists (select 1 from seats s where s.contact_id = c.id
                     and (s.rank >= 50 or s.contract_id in (select contract_id from mine)))
         or exists (select 1 from parties p where p.contact_id = c.id
                     and p.contract_id in (select contract_id from mine))
       )
  )
  select case
    when not (public.is_superadmin() or public.is_project_member(p_project)) then null
    else jsonb_build_object(
      'people', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'contact_id', r.id, 'name', r.name, 'company', r.company,
                 'phone', r.phone, 'phone_2', r.phone_2, 'email', r.email,
                 'seat', r.seat, 'trade', r.trade, 'me', r.me_)
               order by r.rank desc, r.trade nulls last, r.name)
          from rows_ r), '[]'::jsonb))
  end;
$$;

revoke all on function public.portal_project_phone_book(uuid) from public, anon;
grant execute on function public.portal_project_phone_book(uuid) to authenticated;

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
