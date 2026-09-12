-- 076 - every person has a door they land in.
--
-- Shahar (2026-09-12), looking at the "Where to?" picker: "i think this is an
-- un-necessary step. each user should have a default landing even if they own
-- multiple roles, home owner, builder, etc. let's redesign this.
--
--   home owner alone : land on home owner tab
--   home owner and pro : default professional - able to update the default in
--     settings, and able to switch between using that mask from the previous
--     version in the top nav bar
--   admin access only via the top nav bar and only if you have it enabled
--
--   so this screen can be deleted completely; make sure nothing points to it."
--
-- He is right. The picker was built on the idea that guessing costs a person a
-- wrong app and a hunt for the switcher - but the guess is not a guess: a
-- person who works on homes signs in to work, and being an admin is the least
-- likely reason anybody is here on a given morning. One screen, every single
-- sign-in, to ask a question with an obvious answer.
--
-- THE HOUSE RULE, when nobody has said otherwise:
--   Professionals if they hold it - it is the door you come to work through
--   else Homeowner
--   else the portal (admin only, or an account with no door yet)
--
-- ...and app_users.default_door overrides it. Null means the house rule; a
-- door they no longer hold is ignored rather than stranding them.
--
-- Admin is never the house rule's answer for somebody who holds another door.
-- It is reached from the switcher in the top bar, and only appears there for
-- somebody who actually has it.
alter table public.app_users
  add column if not exists default_door text
  check (default_door is null or default_door in ('homeowner', 'expert', 'portal'));

comment on column public.app_users.default_door is
  'Where this person lands after signing in, when they hold more than one door. Null means the house rule: Professionals if they have it, else Homeowner, else the portal. Set from any app''s settings; ignored when the door is no longer held.';

create or replace function public.set_default_door(p_door text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id();
  v  text := nullif(btrim(p_door), '');
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;
  if v is not null and v not in ('homeowner', 'expert', 'portal') then
    return jsonb_build_object('ok', false, 'reason', 'That is not one of the doors.');
  end if;
  update public.app_users set default_door = v where id = me;
  return jsonb_build_object('ok', true, 'default_door', v);
end $$;
revoke all on function public.set_default_door(text) from public, anon;
grant execute on function public.set_default_door(text) to authenticated, service_role;

-- my_doors() carries the choice, so the one read every signed-in screen makes
-- already answers "and where does this person belong".
CREATE OR REPLACE FUNCTION public.my_doors()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (
    select u.id as app_user_id, u.contact_id, u.full_name, u.email,
           coalesce(u.is_superadmin, false) as is_superadmin,
           u.default_door
      from app_users u where u.id = public.current_app_user_id()
  ),
  seats as (
    select pm.project_id, coalesce(pr.authority_rank, 0) as rank
      from me, project_members pm
      left join project_roles pr on pr.role = coalesce(pm.project_role, pm.role)
     where pm.status = 'active'
       and (pm.app_user_id = me.app_user_id
            or (pm.app_user_id is null and pm.contact_id = me.contact_id))
  )
  select case when me.app_user_id is null then jsonb_build_object('signed_in', false)
  else jsonb_build_object(
    'signed_in', true,
    'name', me.full_name,
    'email', me.email,
    'homeowner', exists (
      select 1 from seats s join projects p on p.id = s.project_id
       where p.asset_id is not null and p.trashed_at is null),
    'expert', exists (select 1 from contractor_approvals ca where ca.contact_id = me.contact_id)
           or exists (select 1 from bids b where b.bidder_contact_id = me.contact_id)
           or exists (select 1 from contact_trade_roles r where r.contact_id = me.contact_id)
           or exists (select 1 from seats s where s.rank >= 50),
    'manages', exists (select 1 from seats s where s.rank >= 50),
    'admin', me.is_superadmin,
    'default_door', me.default_door,
    'contractor_status', (select ca.status from contractor_approvals ca where ca.contact_id = me.contact_id)
  ) end
  from me;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
