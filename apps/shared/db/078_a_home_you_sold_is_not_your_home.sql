-- 078 - a home you sold is not your home.
--
-- Shahar (2026-09-12), seeing 254 Concord offered in "Which home?" on a quote
-- request: "254 was sold already, so I should not be able to add projects to it."
-- He is right. It closed on 2026-01-15 for $1,725,000 and Omer Maman lives there.
--
-- homeowner_home_ids asked only who OWNS the row, and projects.owner_user_id is
-- still Shahar because nothing hands a property over when it sells. So the house
-- kept appearing everywhere the list is used: the home picker on a quote request,
-- the homes list on the profile, and homeowner_book - which means new work could
-- have been booked onto a stranger's house.
--
-- The fact to read is the sale, not the status: 52 Ryerson is "Closed -
-- Incomplete" and still his, with an improvements job running under it. Only
-- sold_date says the property changed hands. Selling it removes it from the
-- seller's list; it does not touch the project, its history or its showcase page.
--
-- NOT solved here, and it is the other half: a sold house has no new owner in
-- the system. projects.sold_to is free text ("Omer Maman"), so the buyer is not
-- a party and cannot be handed the keys. Until that exists, a sold home belongs
-- to nobody in the app, which is why this only hides it.
create or replace function public.homeowner_home_ids(p_user uuid default current_app_user_id())
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select p.id
    from public.projects p
    left join public.projects par on par.id = p.parent_project_id
   where p.owner_user_id = p_user
     and p.trashed_at is null
     and coalesce(p.is_template, false) = false
     and p.address is not null
     and p.sold_date is null
     and (p.parent_project_id is null
          or (p.asset_id is not null and par.asset_id is distinct from p.asset_id));
$fn$;

comment on function public.homeowner_home_ids(uuid) is
'The homes a person may act on: owned, not trashed, not a template, has an address, and NOT SOLD. Feeds homeowner_me (the profile and the "Which home?" picker) and homeowner_book, so a property that changed hands can neither be shown as theirs nor booked onto. Reads sold_date, not status - a closed project can still be owned (52 Ryerson), but a sold one cannot.';

update public.config
   set schema_version = 292,
       schema_updated_at = current_date,
       release_notes = 'v292 (repo 078) - A home you sold is not your home. homeowner_home_ids now excludes projects with a sold_date, so 254 Concord stops appearing in the home picker, the profile and homeowner_book. Reads the sale rather than the status, because a closed project can still be owned. Open: projects.sold_to is free text, so a sold house has no new owner and cannot be handed over.';
