-- RESCUED FROM SUPABASE, 2026-09-21 — AND IT WAS ON NO BRANCH AT ALL.
--
-- Applied on 2026-09-12 as v293f_handover_reuses_the_sellers_old_seat
-- (version 20260912154042), twenty minutes after 208, and it is the version
-- of project_hand_over that is actually live. No file for it existed
-- anywhere: not on main, and not on the stale branch that at least carried
-- the other two. Without this, 208 alone would read as the current handover
-- and it has not been for nine days.
--
-- Filed at the end of the series for the same reason as 207 and 208.
-- Nothing here is re-applied.
--
-- ---------------------------------------------------------------------
-- Third time, and the cause is worth writing down: the one-seat-per-person-per-role
-- index does NOT filter on status, so a seat someone RETIRED years ago still
-- occupies its slot. Shahar's site-manager seat on 254 Concord is 'removed', and
-- renaming his ownership seat into that role collided with the ghost.
--
-- So the handover never renames. It retires the ownership seat and REVIVES the
-- old working seat if one is there, inserting a fresh one only when it is not.
-- History is kept either way, which is the point of retiring rather than deleting.
create or replace function public.project_hand_over(
  p_project uuid,
  p_buyer_contact uuid,
  p_sold_date date default null,
  p_sold_amount numeric default null,
  p_buyer_broker_contact uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
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
      -- The ownership seat ends. Retired, never deleted: who owned what and until
      -- when is the record a sale exists to leave behind.
      update public.project_members
         set status = 'removed', left_on = v_when,
             notes = 'Owned it until the sale on ' || to_char(v_when, 'YYYY-MM-DD') || ' (project_hand_over).'
       where project_id = k.id and status = 'active'
         and (contact_id = v_seller_contact or app_user_id = v_seller_user)
         and project_role = 'asset owner';
      get diagnostics v_n = row_count;
      v_retired := v_retired + v_n;

      -- A working seat, so the punch list is still his to finish. Revive the old
      -- one whatever state it is in; otherwise open a new one.
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

    -- The buyer takes the ownership seat. No login needed to hold it (rulebook 15);
    -- it grants nothing until he has one.
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
