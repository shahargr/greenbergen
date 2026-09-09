-- 029 - a professional service is a trade you can offer.
--
-- Shahar: "contractor and project manager should be merged, as contractor can
-- offer project management services as a trade" and "if not included, add
-- realtor as a trade".
--
-- REALTOR WAS ALREADY THERE - and so was PROJECT MANAGER. Neither could be
-- PICKED, and both for the same reason: contractor_trade_catalogue() lists
-- `where t.is_construction or t.is_service`, and these are neither. They are
-- is_professional, a third class the picker never asked for. Fifteen trades
-- sat in that hole:
--
--   Architecture · Architectural Rendering · Asbestos · Attorney · Finance
--   Home Inspection · Insurance · Interior Design · Oil Tank Sweep
--   PROJECT MANAGER · Realtor · Site Engineering · Surveyor · Town Official
--   Utilities & Municipalities
--
-- So the fix is not "add realtor". It is that the picker was construction-only
-- in a business that is not - the people who look after a home include the
-- ones who never pick up a tool. Adding the class opens all fifteen at once,
-- and the two Shahar named come with it.
--
-- NOT EVERY ONE OF THEM IS SOMETHING A MEMBER HIRES: Town Official and
-- Utilities & Municipalities are counterparties on a build, not services for
-- sale. They are marked is_worker_trade = false and the picker now honours
-- that, which is the column's actual job.
--
-- PROJECT MANAGER carried is_worker_trade = false, which was the second lock
-- on the same door - the admin console's checklist reads that column. It is
-- true now: project management IS work someone does for hire, which is
-- exactly Shahar's point. Renamed to sentence case while nothing but one
-- contact_trade_roles row references it (the FK cascades on update; bids,
-- promotions and blueprint_packages, which do not cascade, hold none) -
-- every other trade reads "Smart Home", not "SMART HOME", and the shout
-- was showing up in the contractor's own trade chips.

update public.trades
   set is_worker_trade = true
 where trade = 'PROJECT MANAGER';

update public.trades
   set trade = 'Project manager'
 where trade = 'PROJECT MANAGER';

-- These two are parties to a build, never a service a member buys.
update public.trades
   set is_worker_trade = false
 where trade in ('Town Official', 'Utilities & Municipalities');

-- The picker: everything a person can be hired for, whichever class it sits
-- in, and nothing that is only a counterparty.
create or replace function public.contractor_trade_catalogue()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'trade', t.trade, 'stage', t.stage, 'licence', t.license_label, 'needs_docs', t.requires_documentation)
    order by t.sort_order, t.trade), '[]'::jsonb)
  from public.trades t
  where t.is_worker_trade
    and (t.is_construction or t.is_service or t.is_professional);
$$;

comment on function public.contractor_trade_catalogue() is
  'Every trade a person can be hired for - construction, service OR professional (a project manager, a realtor, an inspector). is_worker_trade excludes the counterparties: a town official is on the job, not for hire.';

revoke all on function public.contractor_trade_catalogue() from public, anon;
grant execute on function public.contractor_trade_catalogue() to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
