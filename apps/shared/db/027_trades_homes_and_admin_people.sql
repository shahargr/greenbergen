-- 027 - two trades, a home you can edit, and the admin's hands on a person.
--
-- TRADES (rulebook 03: the vocabulary is the table). Shahar asked for
-- "smart home" and "bill negotiator".
--   Smart Home      - 'Media & Smart Home' already existed (one contact holds
--                     it). Renamed rather than duplicated (rulebook 30); every
--                     FK to trades.trade cascades on update except bids,
--                     promotions and blueprint_packages, which hold no row
--                     with it, so the rename is clean.
--   Bill Negotiator - new. A service, not construction: nobody permits it,
--                     nothing is built. It is also the honest trade for the
--                     Internet & TV package, which was filed under Handyman
--                     and therefore lit up as "covered" the moment a handyman
--                     was approved. Nobody negotiates bills yet; the tile now
--                     says so.
--
-- HOMES. The homeowner's list of homes moves off the project page and into
-- the profile, where it is editable. Nothing could edit a home before:
-- homeowner_home_add creates, trash_own_project removes, nothing renames.
-- homeowner_home_update fills that hole, owner-only, through the same
-- homeowner_home_ids() membership test the rest of the app uses.
--
-- ADMIN. The console could suspend an account with no reason kept anywhere,
-- and could not touch trades at all. Two functions, superadmin only:
--   admin_user_set_active(user, active, note) - one switch for the account
--     AND its contact, with the reason on both rows. contacts already had
--     disabled_at/disabled_reason (added 2026-09-09); app_users gets the
--     same pair so the account carries its own reason when there is no
--     contact behind it.
--   admin_user_trades_set(contact, trades[]) - the whole set in one call,
--     so "add" and "remove" are the same operation and cannot disagree.

-- ---------------------------------------------------------------------------
-- Trades
update public.trades set trade = 'Smart Home' where trade = 'Media & Smart Home';

insert into public.trades (trade, is_worker_trade, sort_order, is_construction, is_supply, is_professional, is_service, requires_documentation, stage, license_label)
values ('Bill Negotiator', true, 266, false, false, false, true, false, 'Others', null)
on conflict (trade) do nothing;

update public.blueprint_packages
   set trade = 'Bill Negotiator', last_modified_by = 'claude:home-owner-flows'
 where code = 'internet_tv';

-- ---------------------------------------------------------------------------
-- Homes: rename / re-address your own home
create or replace function public.homeowner_home_update(p_project uuid, p_name text default null, p_address text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare me uuid := public.current_app_user_id();
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if p_project is null or p_project not in (select public.homeowner_home_ids(me)) then
    return jsonb_build_object('ok', false, 'reason', 'That home is not yours.');
  end if;
  if coalesce(nullif(btrim(p_name), ''), nullif(btrim(p_address), '')) is null then
    return jsonb_build_object('ok', false, 'reason', 'Give the home a name or an address.');
  end if;
  update public.projects
     set project_name = coalesce(nullif(btrim(p_name), ''), project_name),
         address      = coalesce(nullif(btrim(p_address), ''), address),
         last_modified_by = 'homeowner-app', last_modified_at = now()
   where id = p_project;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.homeowner_home_update(uuid, text, text) from public, anon;
grant execute on function public.homeowner_home_update(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin: account on/off with a reason, kept on the account and its contact
alter table public.app_users
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_reason text;

comment on column public.app_users.disabled_reason is
  'Why an administrator switched this account off (is_active = false). Cleared when it is switched back on. The same note is written to contacts.disabled_reason when the account has a contact.';

create or replace function public.admin_user_set_active(p_user uuid, p_active boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare me uuid := public.current_app_user_id(); u public.app_users;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'Admins only.'); end if;
  select * into u from public.app_users where id = p_user;
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'No such account.'); end if;
  if u.id = me and not p_active then return jsonb_build_object('ok', false, 'reason', 'You cannot switch off your own account.'); end if;
  if u.is_superadmin and not p_active then return jsonb_build_object('ok', false, 'reason', 'Remove the admin flag before switching an administrator off.'); end if;
  if not p_active and coalesce(btrim(p_note), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'Say why, in a line. It is kept on the record.');
  end if;

  update public.app_users
     set is_active = p_active,
         disabled_at = case when p_active then null else now() end,
         disabled_reason = case when p_active then null else btrim(p_note) end,
         last_modified_at = now()
   where id = p_user;

  if u.contact_id is not null then
    update public.contacts
       set disabled_at = case when p_active then null else now() end,
           disabled_reason = case when p_active then null else btrim(p_note) end,
           last_modified_by = 'admin:users', last_modified_at = now()
     where id = u.contact_id;
  end if;

  return jsonb_build_object('ok', true, 'active', p_active);
end $$;

revoke all on function public.admin_user_set_active(uuid, boolean, text) from public, anon;
grant execute on function public.admin_user_set_active(uuid, boolean, text) to authenticated, service_role;

-- Admin: the whole trade set for a contact, in one call
create or replace function public.admin_user_trades_set(p_contact uuid, p_trades text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bad text; v_n integer;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'Admins only.'); end if;
  if not exists (select 1 from public.contacts where id = p_contact) then
    return jsonb_build_object('ok', false, 'reason', 'No such contact.');
  end if;
  -- The vocabulary is the table: an unknown trade is refused, not invented.
  select t into v_bad from unnest(coalesce(p_trades, '{}')) t
   where not exists (select 1 from public.trades tr where tr.trade = t) limit 1;
  if v_bad is not null then return jsonb_build_object('ok', false, 'reason', 'Unknown trade: ' || v_bad); end if;

  delete from public.contact_trade_roles r
   where r.contact_id = p_contact and r.trade <> all(coalesce(p_trades, '{}'));
  insert into public.contact_trade_roles (contact_id, trade, domain, created_by)
  select p_contact, t, 'construction', 'admin:users'
    from unnest(coalesce(p_trades, '{}')) t
   where not exists (select 1 from public.contact_trade_roles r where r.contact_id = p_contact and r.trade = t);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'trades', (select coalesce(jsonb_agg(trade order by trade), '[]'::jsonb) from public.contact_trade_roles where contact_id = p_contact));
end $$;

revoke all on function public.admin_user_trades_set(uuid, text[]) from public, anon;
grant execute on function public.admin_user_trades_set(uuid, text[]) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
