-- 040 - blinds and shades are a trade of their own.
--
-- Shahar: "For blinds and shades, you need a blind shade skill. so currently
-- this needs to move over the coming soon section."
--
-- The blinds package was filed under Handyman, and Shahar carries Handyman,
-- so the tile was bookable - an offer would have gone out to a handyman for
-- work that wants someone who hangs blinds for a living. The tile is not the
-- thing to change. The TRADE is: a vocabulary row (rulebook 03), which the
-- coverage rule then reads on its own - nobody approved carries it, so
-- homeowner_trade_covered() says no and the tile dims to "Coming soon"
-- without the app learning anything about blinds.
--
-- Modelled on Handyman: a service trade, no licence, documents required
-- before the first accept like every worker trade. Sorted beside it.
insert into public.trades
  (trade, stage, is_worker_trade, is_construction, is_service, is_professional, is_supply,
   license_label, requires_documentation, sort_order)
values
  ('Blinds & Shades', 'Others', true, true, true, false, false, null, true, 266)
on conflict (trade) do nothing;

-- The package follows the trade. blueprint_packages.trade is an FK to
-- trades without ON UPDATE CASCADE (migration 029 notes), so the trade row
-- had to exist first.
update public.blueprint_packages
   set trade = 'Blinds & Shades', last_modified_at = now(), last_modified_by = 'migration 040'
 where code = 'blinds';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
