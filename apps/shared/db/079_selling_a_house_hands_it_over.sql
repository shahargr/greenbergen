-- 079 - selling a house hands it over.
--
-- Shahar (2026-09-12): the buyer must be a contact, and the sale must move the
-- house and its projects to him. "It's possible that we will sell a project and
-- still have a punch list which is open. The owner of the punch list becomes the
-- new owner, and it needs to be delivered by the seller."
--
-- A sale used to be three loose facts on the project - a date, an amount, and
-- sold_to as FREE TEXT ("Omer Maman"). The buyer was not a party, so he could not
-- be given the house, invited to it, or shown the punch list he had just bought.
-- A sale also has two brokers and there was one column, ours.
--
-- THE SEAT TRAP, paid for three times before it was understood: the
-- one-seat-per-person-per-role index does NOT filter on status, so a seat
-- someone retired long ago still occupies its slot. Shahar's site-manager seat
-- on 254 Concord is 'removed', and renaming his ownership seat into that role
-- collided with the ghost. So the handover never renames a seat. It retires the
-- ownership seat and revives the old working seat if one is there.

alter table public.projects
  add column if not exists sold_to_contact_id uuid references public.contacts(id),
  add column if not exists sold_buyer_broker_contact_id uuid references public.contacts(id);

comment on column public.projects.sold_to_contact_id is
'The BUYER, as a party. sold_to stays as the name we were told; this is the contact it resolves to. Set by project_hand_over.';
comment on column public.projects.sold_buyer_broker_contact_id is
'The broker on the BUYER''S side. sold_broker_contact_id is ours (the listing agent); a sale has two sides and one column could only ever hold one.';

create index if not exists idx_projects_sold_to_contact on public.projects(sold_to_contact_id) where sold_to_contact_id is not null;

-- The downward walk. project_ancestry climbs to the umbrella (that is what
-- membership inherits along); a handover needs the opposite - the house and
-- every job beneath it - and nothing offered that.
create or replace function public.project_ancestry_down(p_project_id uuid)
returns table(id uuid)
language sql stable security definer set search_path = public
as $fn$
  with recursive down as (
    select p.id, 1 as depth from public.projects p where p.id = p_project_id
    union all
    select c.id, d.depth + 1 from public.projects c join down d on c.parent_project_id = d.id
     where d.depth < 10
  )
  select id from down;
$fn$;

comment on function public.project_ancestry_down(uuid) is
'A project and every project beneath it, to ten levels. The mirror of project_ancestry, which climbs. Used by project_hand_over: selling a house sells the jobs on it.';

revoke all on function public.project_ancestry_down(uuid) from public, anon;
grant execute on function public.project_ancestry_down(uuid) to authenticated, service_role;

create or replace function public.project_hand_over(
  p_project uuid,
  p_buyer_contact uuid,
  p_sold_date date default null,
  p_sold_amount numeric default null,
  p_buyer_broker_contact uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  pr public.projects; v_buyer public.contacts; v_buyer_user uuid;
  v_seller_user uuid; v_seller_contact uuid; v_seat uuid; v_when date;
  v_kids int := 0; v_punch int := 0; v_retired int := 0; v_n int := 0; k record;
begin
  perform public.assert_own_hands();
  select * into pr from public.projects where id = p_project;
  if pr.id is null then return jsonb_build_object('ok', false, 'reason', 'No such project.'); end if;
  if not (public.is_superadmin() or public.my_authority_rank(p_project) >= 70) then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOURS', 'reason', 'Only the owner of the property can hand it over.');
  end if;
  select * into v_buyer from public.contacts where id = p_buyer_contact;
  if v_buyer.id is null then return jsonb_build_object('ok', false, 'reason', 'The buyer must be a contact first.'); end if;

  v_seller_user := pr.owner_user_id;
  select contact_id into v_seller_contact from public.app_users where id = v_seller_user;
  select id into v_buyer_user from public.app_users where contact_id = p_buyer_contact and is_active limit 1;
  v_when := coalesce(p_sold_date, pr.sold_date, current_date);

  update public.projects
     set sold_to_contact_id = p_buyer_contact,
         sold_to = coalesce(nullif(btrim(coalesce(sold_to,'')),''), coalesce(v_buyer.person_name, v_buyer.name)),
         sold_date = v_when,
         sold_amount = coalesce(p_sold_amount, sold_amount),
         sold_buyer_broker_contact_id = coalesce(p_buyer_broker_contact, sold_buyer_broker_contact_id),
         last_modified_by = 'project_hand_over'
   where id = p_project;

  select count(*) into v_punch from public.actions a
   where a.project_id in (select id from public.project_ancestry_down(p_project))
     and a.status not in ('Completed','Cancelled','Force Cancelled');

  for k in select id from public.project_ancestry_down(p_project) loop
    if v_seller_contact is not null and v_seller_contact is distinct from p_buyer_contact then
      update public.project_members
         set status = 'removed', left_on = v_when,
             notes = 'Owned it until the sale on ' || to_char(v_when, 'YYYY-MM-DD') || ' (project_hand_over).'
       where project_id = k.id and status = 'active'
         and (contact_id = v_seller_contact or app_user_id = v_seller_user)
         and project_role = 'asset owner';
      get diagnostics v_n = row_count;
      v_retired := v_retired + v_n;

      select id into v_seat from public.project_members
       where project_id = k.id and project_role = 'site project manager'
         and (contact_id = v_seller_contact or app_user_id = v_seller_user)
         and contract_id is null and company_id is null
       limit 1;

      if v_seat is not null then
        update public.project_members
           set status = 'active', role = 'collaborator', left_on = null, accepted_at = coalesce(accepted_at, now()),
               can_view_financials = true, can_edit_scope = false, can_invite = false, can_hire = false,
               notes = 'Sold the property on ' || to_char(v_when, 'YYYY-MM-DD') || ' and still owes the punch list (project_hand_over).'
         where id = v_seat;
      else
        insert into public.project_members (project_id, contact_id, app_user_id, role, project_role, status, accepted_at,
                                            can_view_financials, can_edit_scope, can_invite, can_hire, notes)
        values (k.id, v_seller_contact, v_seller_user, 'collaborator', 'site project manager', 'active', now(),
                true, false, false, false,
                'Sold the property on ' || to_char(v_when, 'YYYY-MM-DD') || ' and still owes the punch list (project_hand_over).')
        on conflict do nothing;
      end if;
    end if;

    if exists (select 1 from public.project_members m
                where m.project_id = k.id and m.project_role = 'asset owner'
                  and m.contact_id = p_buyer_contact and m.contract_id is null and m.company_id is null) then
      update public.project_members
         set status = 'active', role = 'owner', left_on = null, app_user_id = coalesce(app_user_id, v_buyer_user),
             can_view_financials = true, can_edit_scope = true, can_invite = true, can_hire = true,
             notes = 'Bought the property on ' || to_char(v_when, 'YYYY-MM-DD') || ' (project_hand_over).'
       where project_id = k.id and project_role = 'asset owner' and contact_id = p_buyer_contact
         and contract_id is null and company_id is null;
    else
      insert into public.project_members (project_id, contact_id, app_user_id, role, project_role, status, accepted_at,
                                          can_view_financials, can_edit_scope, can_invite, can_hire, notes)
      values (k.id, p_buyer_contact, v_buyer_user, 'owner', 'asset owner', 'active', now(),
              true, true, true, true,
              'Bought the property on ' || to_char(v_when, 'YYYY-MM-DD') || ' (project_hand_over).');
    end if;
    v_kids := v_kids + 1;
  end loop;

  if v_buyer_user is not null then
    update public.projects set owner_user_id = v_buyer_user, last_modified_by = 'project_hand_over'
     where id in (select id from public.project_ancestry_down(p_project));
  end if;

  return jsonb_build_object('ok', true, 'project_id', p_project, 'buyer_contact_id', p_buyer_contact,
                            'buyer_has_login', v_buyer_user is not null,
                            'projects_transferred', v_kids, 'open_punch_items', v_punch,
                            'seller_ownership_seats_retired', v_retired);
end
$fn$;

comment on function public.project_hand_over(uuid, uuid, date, numeric, uuid) is
'Sells a property to a buyer who is a CONTACT: records the sale and both brokers, seats the buyer as asset owner on the house and every job under it, retires the seller''s ownership seat while leaving him a working one, and moves owner_user_id once the buyer has a login. The open punch list is untouched - the buyer owns it because he owns the house, the seller keeps a seat because he still has to deliver it. Idempotent; re-run after the buyer signs up to finish the login-level transfer.';

revoke all on function public.project_hand_over(uuid, uuid, date, numeric, uuid) from public, anon;
grant execute on function public.project_hand_over(uuid, uuid, date, numeric, uuid) to authenticated, service_role;
