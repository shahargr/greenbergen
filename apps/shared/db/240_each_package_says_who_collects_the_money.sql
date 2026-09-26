-- 240 EACH PACKAGE SAYS WHO COLLECTS THE MONEY
--
-- Shahar (2026-09-25), on the epoxy garage floor's proposal: "customer should
-- always see end user price" - and then, asked how that squares with rulebook
-- 52 (Green Bergen never holds the money): "Update the rulebook. Per Package,
-- decide on the money flow. Customer pays contractor per milestone, or,
-- Customer pays GreenBergen per milestone and GreenBergen pays the contractor.
-- In option a, the contractor will pay GreenBergen for the lead, and in option
-- B GreenBergen can keep the 15% or whatever it is and pay the rest."
--
-- WHAT THE HOMEOWNER SEES IS THE SAME EITHER WAY: the end-user price, the
-- contractor price plus the mark-up (migration 237, project_bookings.
-- customer_price_cents), split across the package's payment milestones.
-- What differs is who the homeowner hands each milestone to:
--
--   contractor    (a) the homeowner pays the contractor per milestone; the
--                 contractor owes Green Bergen the mark-up for the lead. The
--                 old non-custodial flow, and the default for every package.
--   green_bergen  (b) the homeowner pays Green Bergen per milestone; Green
--                 Bergen keeps the mark-up and pays the contractor the rest.
--
-- blueprint_packages.collected_by is the package's choice, set in Admin >
-- Packages. project_billing_plan.collected_by is the job's COPY, frozen when
-- the job is posted (homeowner_post_internal) - copy down, do not link
-- (rulebook 41, 52): changing a package's flow never changes it under a job
-- that is already out. Nothing existing modelled this: fee_bearer says who
-- bears the fee, not who takes the money in.
--
-- homeowner_package and admin_package return it; admin_package_save takes it.
-- The payment-recording screens (record_manual_payment, the milestone page)
-- still record a payment to the contractor; a job that collects through Green
-- Bergen needs its own recording path before the first one goes out.

alter table public.blueprint_packages add column if not exists collected_by text not null default 'contractor'
  check (collected_by in ('contractor', 'green_bergen'));
comment on column public.blueprint_packages.collected_by is
  'Who the homeowner pays each payment milestone to (migration 240). contractor: the homeowner pays the contractor, who owes Green Bergen the mark-up for the lead. green_bergen: the homeowner pays Green Bergen, which keeps the mark-up and pays the contractor the rest. Either way the homeowner sees the end-user price. Copied onto project_billing_plan.collected_by at posting. Set in Admin > Packages.';

alter table public.project_billing_plan add column if not exists collected_by text
  check (collected_by is null or collected_by in ('contractor', 'green_bergen'));
comment on column public.project_billing_plan.collected_by is
  'The job''s copy of blueprint_packages.collected_by, frozen when the job was posted (migration 240): who the homeowner pays each milestone to. Null = not a package job, or posted before 240 (the contractor collected).';

do $mig$
declare
  src text; n int;
  edits jsonb;
  e jsonb;
begin
  edits := jsonb_build_array(
    jsonb_build_object('fn', 'public.homeowner_package(text)',
      'a', '''guided_photos'', p.guided_photos,',
      'b', E'''guided_photos'', p.guided_photos,\n    ''collected_by'', p.collected_by,'),
    jsonb_build_object('fn', 'public.admin_package(text)',
      'a', '''photo_url'', p.photo_url, ''promote'', p.promote,',
      'b', '''photo_url'', p.photo_url, ''promote'', p.promote, ''collected_by'', p.collected_by,'),
    jsonb_build_object('fn', 'public.admin_package_save(text,jsonb)',
      'a', 'if p_patch ? ''promote''       then p.promote := coalesce((p_patch->>''promote'')::boolean, false); end if;',
      'b', E'if p_patch ? ''promote''       then p.promote := coalesce((p_patch->>''promote'')::boolean, false); end if;\n  if p_patch ? ''collected_by''  then p.collected_by := coalesce(nullif(btrim(p_patch->>''collected_by''), ''''), p.collected_by); end if;'),
    jsonb_build_object('fn', 'public.admin_package_save(text,jsonb)',
      'a', 'is_active, category, season_months, photo_url, promote, created_by,',
      'b', 'is_active, category, season_months, photo_url, promote, collected_by, created_by,'),
    jsonb_build_object('fn', 'public.admin_package_save(text,jsonb)',
      'a', 'p.is_active, p.category, p.season_months, p.photo_url, p.promote, who,',
      'b', 'p.is_active, p.category, p.season_months, p.photo_url, p.promote, coalesce(p.collected_by, ''contractor''), who,'),
    jsonb_build_object('fn', 'public.admin_package_save(text,jsonb)',
      'a', 'photo_url = p.photo_url, promote = p.promote,',
      'b', 'photo_url = p.photo_url, promote = p.promote, collected_by = p.collected_by,'),
    jsonb_build_object('fn', 'public.homeowner_post_internal(uuid)',
      'a', 'fee_bearer, status, started_on, fee_collection_fallback, notes)',
      'b', 'fee_bearer, status, started_on, fee_collection_fallback, notes, collected_by)'),
    jsonb_build_object('fn', 'public.homeowner_post_internal(uuid)',
      'a', 'frozen here at posting.'';',
      'b', 'frozen here at posting.'', pkg.collected_by;')
  );
  for e in select * from jsonb_array_elements(edits) loop
    src := pg_get_functiondef((e->>'fn')::regprocedure);
    n := (length(src) - length(replace(src, e->>'a', ''))) / length(e->>'a');
    if n <> 1 then raise exception 'Migration 240: % matched % times in %, expected 1.', e->>'a', n, e->>'fn'; end if;
    execute replace(src, e->>'a', e->>'b');
  end loop;
end $mig$;

comment on column public.config.markup_pct is
  'The mark-up on top of the contractor price for every package, in percent (default 15). A user_groups row may override it for its members. The homeowner always sees contractor price + mark-up. Who collects it is per package (blueprint_packages.collected_by, migration 240): the contractor pays it to Green Bergen for the lead, or Green Bergen collects the milestone and keeps it. Set in Admin > Mark-up.';

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
