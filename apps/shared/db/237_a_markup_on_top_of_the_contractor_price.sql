-- A MARK-UP ON TOP OF THE CONTRACTOR PRICE.
--
-- Shahar, 2026-09-25: "for all packages, add an admin option for mark-up on
-- top of contractor price. default is 15%." Asked how that squares with
-- rulebook 52 (we earn a fee, we never hold the money), he chose the fee on
-- top: "one setting for all users, with override per groups of users. Groups
-- of users to be defined in the Admin portal for now." And: "the price to be
-- presented is the contractor price + markup."
--
-- So nothing about custody changes. The package price (base + lever deltas,
-- homeowner_price) is now what it always was underneath: the CONTRACTOR's
-- price, the contract amount, the payment stages. On top of it sits the
-- mark-up, and it is collected the way rule 52 already collects a fee: the
-- job's project_billing_plan is percent_of_milestone at the mark-up, borne by
-- the homeowner. On a card the fee rides along as the application fee; on a
-- cheque it becomes a pending platform_charges row. The homeowner is shown
-- contractor price + mark-up everywhere; the contractor is shown their price.
--
--   config.markup_pct          the one setting for everyone (default 15)
--   user_groups                a group of users with an optional override
--   user_group_members         who is in which group (one group per user)
--   markup_pct_for(user)       the group's override, else the setting
--   project_bookings.markup_pct           frozen on the booking (rule 52:
--   project_bookings.customer_price_cents copy down, never re-price someone
--                              who agreed) - customer_price_cents is
--                              GENERATED, so a bump or a weekly re-price of
--                              price_cents moves it without a second write.
--
-- A booking made before this migration has no markup_pct and its customer
-- price is its price: nobody who already agreed is re-priced.
--
-- Also here, because it rides on the same functions: the EV charger's
-- answers (migration 232's flow, facts.ev) reach the contractor on the job
-- as work_details. Shahar: "as part of the work file these images should be
-- visible." The rest of facts stays the owner's.

-- ---- the setting ----------------------------------------------------------
alter table public.config add column if not exists markup_pct numeric(5,2) not null default 15
  check (markup_pct >= 0 and markup_pct <= 100);
comment on column public.config.markup_pct is
  'The mark-up on top of the contractor price for every package, in percent (default 15). A user_groups row may override it for its members. Collected as a fee on top (percent_of_milestone, homeowner bears it) - rulebook 52, never custody. Set in Admin > Mark-up.';

-- ---- groups of users -------------------------------------------------------
create table if not exists public.user_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 80),
  markup_pct numeric(5,2) check (markup_pct is null or (markup_pct >= 0 and markup_pct <= 100)),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text,
  last_modified_at timestamptz,
  last_modified_by text
);
comment on table public.user_groups is
  'A named group of users that can carry its own settings, starting with a mark-up override (markup_pct; null = use config.markup_pct). Separate from plans, which are capability tiers (storage, invites, media) and say nothing about price. Defined in Admin > Mark-up. Retire with is_active = false, never delete while members point at it.';

create table if not exists public.user_group_members (
  app_user_id uuid primary key references public.app_users(id) on delete cascade,
  group_id uuid not null references public.user_groups(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by text
);
create index if not exists user_group_members_group_idx on public.user_group_members (group_id);
comment on table public.user_group_members is
  'Who is in which user_groups row. The primary key is the user, so a user is in at most one group and their mark-up has exactly one answer.';

alter table public.user_groups enable row level security;
alter table public.user_group_members enable row level security;
drop policy if exists user_groups_superadmin on public.user_groups;
create policy user_groups_superadmin on public.user_groups for all using (public.is_superadmin()) with check (public.is_superadmin());
drop policy if exists user_group_members_superadmin on public.user_group_members;
create policy user_group_members_superadmin on public.user_group_members for all using (public.is_superadmin()) with check (public.is_superadmin());

drop trigger if exists trg_log_user_groups on public.user_groups;
create trigger trg_log_user_groups after insert or delete or update on public.user_groups
  for each row execute function public.fn_log_change('id');
drop trigger if exists trg_log_user_group_members on public.user_group_members;
create trigger trg_log_user_group_members after insert or delete or update on public.user_group_members
  for each row execute function public.fn_log_change('app_user_id');

-- ---- who pays what ---------------------------------------------------------
create or replace function public.markup_pct_for(p_user uuid)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select g.markup_pct from public.user_group_members m join public.user_groups g on g.id = m.group_id
      where m.app_user_id = p_user and g.is_active and g.markup_pct is not null),
    (select c.markup_pct from public.config c limit 1),
    15);
$$;
comment on function public.markup_pct_for(uuid) is
  'The mark-up a user pays on top of the contractor price: their active group''s override, else config.markup_pct. Internal - callers are homeowner_book, homeowner_post_internal and my_markup_pct.';
revoke all on function public.markup_pct_for(uuid) from public, anon, authenticated;

create or replace function public.my_markup_pct()
returns numeric language sql stable security definer set search_path to 'public' as $$
  select public.markup_pct_for(public.current_app_user_id());
$$;
comment on function public.my_markup_pct() is
  'The signed-in user''s mark-up, for the homeowner app to show contractor price + mark-up. A visitor reads the setting from public_settings().markup_pct instead.';
revoke all on function public.my_markup_pct() from public, anon;
grant execute on function public.my_markup_pct() to authenticated;

-- The one rounding rule, mirrored by customerPrice() in apps/shared catalogue.ts.
create or replace function public.homeowner_customer_price(p_cents integer, p_pct numeric)
returns integer language sql immutable as $$
  select p_cents + round(p_cents * coalesce(p_pct, 0) / 100.0)::integer;
$$;

-- A visitor's prices use the setting; it is public in every price anyway.
create or replace function public.public_settings()
 returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
           'tagline', c.public_tagline,
           'tagline_shown', c.public_tagline_shown,
           'hero', c.landing_hero_url,
           'bob_hero', c.bob_hero_url,
           'markup_pct', c.markup_pct)
    from public.config c limit 1;
$$;

-- ---- the booking remembers what was agreed ---------------------------------
alter table public.project_bookings add column if not exists markup_pct numeric(5,2)
  check (markup_pct is null or (markup_pct >= 0 and markup_pct <= 100));
alter table public.project_bookings add column if not exists customer_price_cents integer
  generated always as (price_cents + round(price_cents * coalesce(markup_pct, 0) / 100.0)::integer) stored;
comment on column public.project_bookings.markup_pct is
  'The mark-up frozen on this booking when it was made (plan) and when it was posted (the job''s billing plan rate). Null = made before migration 237: no mark-up.';
comment on column public.project_bookings.customer_price_cents is
  'What the homeowner pays: price_cents (the contractor price) + markup_pct. Generated, so a repost bump or a weekly re-price moves it too.';

-- ---- admin -----------------------------------------------------------------
create or replace function public.admin_markup()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'Only a Green Bergen admin can see this.'); end if;
  return jsonb_build_object('ok', true,
    'markup_pct', (select markup_pct from public.config limit 1),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'markup_pct', g.markup_pct, 'notes', g.notes, 'is_active', g.is_active,
        'members', coalesce((select jsonb_agg(jsonb_build_object('app_user_id', u.id, 'email', u.email, 'full_name', u.full_name) order by lower(coalesce(u.full_name, u.email)))
                               from public.user_group_members m join public.app_users u on u.id = m.app_user_id where m.group_id = g.id), '[]'::jsonb))
        order by g.is_active desc, lower(g.name)) from public.user_groups g), '[]'::jsonb));
end $$;

create or replace function public.admin_markup_set(p_pct numeric)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'Only a Green Bergen admin can change the mark-up.'); end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then return jsonb_build_object('ok', false, 'reason', 'A mark-up is between 0 and 100 percent.'); end if;
  select id into v_id from public.config limit 1;
  update public.config set markup_pct = round(p_pct, 2) where id = v_id;
  return jsonb_build_object('ok', true, 'markup_pct', round(p_pct, 2));
end $$;

create or replace function public.admin_user_group_save(p_id uuid, p_name text, p_markup_pct numeric, p_notes text, p_is_active boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid := p_id; v_name text := nullif(btrim(p_name), ''); v_by text := 'app_user:' || coalesce(public.current_app_user_id()::text, '?');
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'Only a Green Bergen admin can change groups.'); end if;
  if v_name is null then return jsonb_build_object('ok', false, 'reason', 'A group needs a name.'); end if;
  if p_markup_pct is not null and (p_markup_pct < 0 or p_markup_pct > 100) then return jsonb_build_object('ok', false, 'reason', 'A mark-up is between 0 and 100 percent.'); end if;
  if exists (select 1 from public.user_groups where lower(name) = lower(v_name) and id is distinct from v_id) then
    return jsonb_build_object('ok', false, 'reason', 'There is already a group called ' || v_name || '.');
  end if;
  if v_id is null then
    insert into public.user_groups (name, markup_pct, notes, is_active, created_by)
    values (v_name, round(p_markup_pct, 2), nullif(btrim(p_notes), ''), coalesce(p_is_active, true), v_by) returning id into v_id;
  else
    update public.user_groups set name = v_name, markup_pct = round(p_markup_pct, 2), notes = nullif(btrim(p_notes), ''),
           is_active = coalesce(p_is_active, is_active), last_modified_at = now(), last_modified_by = v_by
     where id = v_id;
    if not found then return jsonb_build_object('ok', false, 'reason', 'That group does not exist.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Add by email (moves the user if they were in another group), or remove.
create or replace function public.admin_user_group_member_set(p_group_id uuid, p_email text, p_on boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_user uuid; v_was text;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'Only a Green Bergen admin can change groups.'); end if;
  if not exists (select 1 from public.user_groups where id = p_group_id) then return jsonb_build_object('ok', false, 'reason', 'That group does not exist.'); end if;
  select id into v_user from public.app_users where lower(email) = lower(btrim(p_email)) limit 1;
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'Nobody has signed up with ' || coalesce(btrim(p_email), 'that email') || '.'); end if;
  if coalesce(p_on, true) then
    select g.name into v_was from public.user_group_members m join public.user_groups g on g.id = m.group_id
     where m.app_user_id = v_user and m.group_id <> p_group_id;
    insert into public.user_group_members (app_user_id, group_id, added_by)
    values (v_user, p_group_id, 'app_user:' || coalesce(public.current_app_user_id()::text, '?'))
    on conflict (app_user_id) do update set group_id = excluded.group_id, added_at = now(), added_by = excluded.added_by;
    return jsonb_build_object('ok', true, 'moved_from', v_was);
  end if;
  delete from public.user_group_members where app_user_id = v_user and group_id = p_group_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_markup() from public, anon;
revoke all on function public.admin_markup_set(numeric) from public, anon;
revoke all on function public.admin_user_group_save(uuid, text, numeric, text, boolean) from public, anon;
revoke all on function public.admin_user_group_member_set(uuid, text, boolean) from public, anon;
grant execute on function public.admin_markup() to authenticated;
grant execute on function public.admin_markup_set(numeric) to authenticated;
grant execute on function public.admin_user_group_save(uuid, text, numeric, text, boolean) to authenticated;
grant execute on function public.admin_user_group_member_set(uuid, text, boolean) to authenticated;

-- ---- the functions that price a booking ------------------------------------
-- Edited in place (as 221 did): each replaced text must match exactly once.
do $mig$
declare
  src text; n int;
  procedure_name text;
  edits jsonb;
  e jsonb;
begin
  edits := jsonb_build_array(
    -- homeowner_book: freeze the booker's mark-up on the row; a plan returns
    -- what the homeowner would pay.
    jsonb_build_object('fn', 'public.homeowner_book(text,jsonb,text,text,jsonb,text,text,uuid,text,text)',
      'a', '  returning id into v_booking;',
      'b', E'  returning id into v_booking;\n  update public.project_bookings set markup_pct = public.markup_pct_for(me) where id = v_booking;'),
    jsonb_build_object('fn', 'public.homeowner_book(text,jsonb,text,text,jsonb,text,text,uuid,text,text)',
      'a', '''price_cents'', v_price, ''target_window''',
      'b', '''price_cents'', v_price, ''customer_price_cents'', (select customer_price_cents from public.project_bookings where id = v_booking), ''target_window'''),
    -- homeowner_post_internal: the mark-up is the job's billing plan.
    jsonb_build_object('fn', 'public.homeowner_post_internal(uuid)',
      'a', '  v_nudge jsonb;',
      'b', E'  v_nudge jsonb;\n  v_markup numeric;'),
    jsonb_build_object('fn', 'public.homeowner_post_internal(uuid)',
      'a', 'price_cents = v_price, base_price_cents = pkg.base_price_cents,',
      'b', 'price_cents = v_price, base_price_cents = pkg.base_price_cents, markup_pct = v_markup,'),
    jsonb_build_object('fn', 'public.homeowner_post_internal(uuid)',
      'a', '''price_cents'', v_price, ''reply_by'', null,',
      'b', '''price_cents'', v_price, ''customer_price_cents'', public.homeowner_customer_price(v_price, v_markup), ''reply_by'', null,'),
    -- homeowner_booking: the owner sees what they pay; the job's crew sees
    -- the EV answers (facts.ev) as work_details.
    jsonb_build_object('fn', 'public.homeowner_booking(uuid)',
      'a', '''facts'', case when v_is_owner then b.facts end,',
      'b', '''facts'', case when v_is_owner then b.facts end, ''work_details'', b.facts->''ev'', ''customer_price_cents'', case when v_is_owner then b.customer_price_cents end, ''markup_pct'', case when v_is_owner then b.markup_pct end, ''live_customer_price_cents'', case when v_is_owner and b.state = ''planned'' then public.homeowner_customer_price((select price_cents from public.homeowner_price(b.package_code, b.selections)), public.markup_pct_for(pr.owner_user_id)) end,'),
    -- homeowner_me: the homeowner's own list.
    jsonb_build_object('fn', 'public.homeowner_me()',
      'a', '''price_cents'', b.price_cents, ''config_label'', b.config_label,',
      'b', '''price_cents'', b.price_cents, ''customer_price_cents'', b.customer_price_cents, ''config_label'', b.config_label,'),
    -- homeowner_share: the public card shows what the homeowner paid.
    jsonb_build_object('fn', 'public.homeowner_share(text)',
      'a', '''price_cents'', b.price_cents,',
      'b', '''price_cents'', b.customer_price_cents,'),
    -- homeowner_booking_action: a repost bump reports the homeowner's new price too.
    jsonb_build_object('fn', 'public.homeowner_booking_action(uuid,text)',
      'a', 'return jsonb_build_object(''ok'', true, ''price_cents'', v_new, ''reply_by'', v_reply);',
      'b', 'return jsonb_build_object(''ok'', true, ''price_cents'', v_new, ''customer_price_cents'', public.homeowner_customer_price(v_new, b.markup_pct), ''reply_by'', v_reply);'),
    -- refresh_stale_offer_prices: the message to the homeowner quotes their prices.
    jsonb_build_object('fn', 'public.refresh_stale_offer_prices()',
      'a', '|| round(v_price/100.0) || '' - it was $'' || round(r.price_cents/100.0) || ''. ''',
      'b', '|| round(public.homeowner_customer_price(v_price, r.markup_pct)/100.0) || '' - it was $'' || round(r.customer_price_cents/100.0) || ''. '''),
    -- homeowner_offer_accept: the timeline both sides read carries no number,
    -- since each side's number is different now.
    jsonb_build_object('fn', 'public.homeowner_offer_accept(uuid,uuid)',
      'a', ''' accepted the job at $'' || round(b.price_cents/100.0) || ''. You now',
      'b', ''' accepted the job. You now')
  );
  for e in select * from jsonb_array_elements(edits) loop
    src := pg_get_functiondef((e->>'fn')::regprocedure);
    n := (length(src) - length(replace(src, e->>'a', ''))) / length(e->>'a');
    if n <> 1 then raise exception 'Migration 237: % matched % times in %, expected 1.', e->>'a', n, e->>'fn'; end if;
    execute replace(src, e->>'a', e->>'b');
  end loop;
end $mig$;

-- The billing plan block in homeowner_post_internal: a package job's plan is
-- the mark-up, borne by the homeowner, whatever the home container carries.
do $mig$
declare src text; i int; j int; blk text;
begin
  src := pg_get_functiondef('public.homeowner_post_internal(uuid)'::regprocedure);
  i := position('  if not exists (select 1 from public.project_billing_plan where project_id = p_project and status = ''active'') then' in src);
  j := position('  insert into public.bid_packages' in src);
  if i = 0 or j = 0 or j < i then raise exception 'Migration 237: billing block not found in homeowner_post_internal.'; end if;
  blk := $blk$  -- Migration 237: the job's plan IS the mark-up (fee on top, rule 52). An
  -- existing plan (a repost) keeps the rate it was posted at.
  select percent_rate into v_markup from public.project_billing_plan
   where project_id = p_project and status = 'active' and model = 'percent_of_milestone' limit 1;
  if not exists (select 1 from public.project_billing_plan where project_id = p_project and status = 'active') then
    v_markup := public.markup_pct_for(me);
    insert into public.project_billing_plan (project_id, copied_from_plan_id, model, currency, percent_rate,
      fee_bearer, status, started_on, fee_collection_fallback, notes)
    select p_project, (select id from public.blueprint_pricing_plan where code = 'pct_milestone' limit 1), 'percent_of_milestone', 'USD', v_markup,
           'homeowner', 'active', current_date, 'invoice',
           'Package mark-up (migration 237): ' || v_markup || '% on top of the contractor price, borne by the homeowner. Set in Admin > Mark-up; frozen here at posting.';
  end if;
  v_markup := coalesce(v_markup, 0);

$blk$;
  execute substring(src from 1 for i - 1) || blk || substring(src from j);
end $mig$;

-- ---- bookkeeping -----------------------------------------------------------
update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
