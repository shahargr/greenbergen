-- THE OFFER CARRIES THE WORK DETAILS.
--
-- Shahar, 2026-09-25, on the EV charger's answers (garage or driveway, the
-- car, the run, the amperage, the subpanel): "as part of the work file these
-- images should be visible." 237 gave them to the crew on the job
-- (homeowner_booking.work_details); this gives the same facts.ev to a
-- contractor weighing the offer, because the amperage and the run are what
-- decide whether the price works. Nothing in facts.ev is an address, so the
-- address rule (migration 008) is untouched. The photos stay with the job:
-- the homeowner was told only the contractor who accepts sees them.
do $mig$
declare src text; n int;
  a constant text := '''price_cents'', b.price_cents,';
  b constant text := '''price_cents'', b.price_cents, ''work_details'', b.facts->''ev'',';
begin
  src := pg_get_functiondef('public.homeowner_offers()'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'Migration 238: matched % times in homeowner_offers, expected 1.', n; end if;
  execute replace(src, a, b);
end $mig$;
