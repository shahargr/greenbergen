-- 168. THE TRADES SIT IN PANELS - FINANCE & INSURANCE, SITE, ROUGH, FINISH.
--
-- Shahar (2026-09-17), on the Finance tile: "this is where i want all the
-- finance tasks will live, and we can club it with insurance. can we do one
-- category finance & insurance. similar, we can club all rough trades under
-- rough, and finish trades under finish. this will reduce the number of
-- panels significantly. find the right way to do that."
--
-- The right way is the one that already exists: every trade sits at a STAGE
-- (trade_stages - Buy and Sell, Rough and mechanical, Finishing...), and the
-- stage is what the spine sorts by. What was missing is one more level of
-- grouping for the SCREEN, because ten stages is still ten headings and a
-- stage like "Stairs and railing" is two trades wide. trade_stages.panel
-- names the panel a stage sits in on the project screen; several stages may
-- share one. The project screen shows one panel per group, in build order,
-- with what is on the job inside it; tapping a panel opens the trades in it
-- as tiles, and each tile opens the trade as before.
--
-- Nothing about the trades, their stages or their order changes. A panel is
-- a word on the screen, so renaming one is an UPDATE here and nowhere else.

alter table public.trade_stages add column if not exists panel text;
comment on column public.trade_stages.panel is
  'The panel this stage sits in on the project screen (migration 168). Several stages may share one; the panel is ordered by the first of its stages.';

update public.trade_stages set panel = case stage
  when 'Buy and Sell'              then 'Finance & insurance'
  when 'Existing house inspection' then 'Inspections'
  when 'Survey & environmental'    then 'Site'
  when 'Site preparation'          then 'Site'
  when 'Rough and mechanical'      then 'Rough'
  when 'Stairs and railing'        then 'Finish'
  when 'Finishing'                 then 'Finish'
  when 'Outdoor'                   then 'Outdoor'
  when 'Suppliers'                 then 'Suppliers'
  when 'Others'                    then 'Running the job'
  else coalesce(panel, stage) end;

-- The spine carries the panel on every trade.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef('public.portal_project_trades(uuid)'::regprocedure) into src;
  out_ := replace(src,
    $a$      'stage', tr.stage,
      'art', tr.illustration,$a$,
    $b$      'stage', tr.stage,
      'panel', coalesce((select s.panel from public.trade_stages s where s.stage = tr.stage), tr.stage, 'Running the job'),
      'panel_order', (select min(s2.sort_order) from public.trade_stages s2
                       where s2.panel = (select s.panel from public.trade_stages s where s.stage = tr.stage)),
      'art', tr.illustration,$b$);
  if out_ = src then raise exception 'portal_project_trades has drifted - the stage/art anchor was not found'; end if;
  execute out_;
end $patch$;

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
