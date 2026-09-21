-- RESCUED FROM A STALE BRANCH, 2026-09-21.
--
-- Applied to Supabase on 2026-09-12 as v293_selling_a_house_hands_it_over
-- (version 20260912153753) and live ever since. Filed at the end of the
-- series for the same reason as 207: the repo's numbering restarted on
-- 2026-09-13 and 079 is already a different migration. Nothing is re-applied.
--
-- TAKEN FROM SUPABASE, NOT FROM THE BRANCH, and the difference matters. The
-- branch's own 079 file is 9,569 bytes; what actually ran is 6,653, and the
-- two do not match even with every comment stripped. So the branch file was
-- not a faithful record of this migration and was not used. What ran is what
-- is filed.
--
-- READ 209 WITH THIS ONE. The handover below re-seats the seller by INSERT,
-- which does nothing when he already holds a seat - twenty minutes later
-- v293f had to fix exactly that.
--
-- ---------------------------------------------------------------------
-- 079 - selling a house hands it over.
--
-- Shahar (2026-09-12): the buyer must be a contact, and the sale must move the
-- house and its projects to him. "It's possible that we will sell a project and
-- still have a punch list which is open. The owner of the punch list becomes the
-- new owner, and it needs to be delivered by the seller."
--
-- Until now a sale was three loose facts on the project - a date, an amount and
-- sold_to as FREE TEXT ("Omer Maman"). The buyer was not a party, so he could not
-- be given the house, invited to it, or shown the punch list he had just bought.
--
-- Two columns make the sale a relationship, and one function performs it.

alter table public.projects
  add column sold_to_contact_id uuid references public.contacts(id),
  add column sold_buyer_broker_contact_id uuid references public.contacts(id);

comment on column public.projects.sold_to_contact_id is
'The BUYER, as a party. sold_to stays as the name we were told; this is the contact it resolves to. Set by project_hand_over.';
comment on column public.projects.sold_buyer_broker_contact_id is
'The broker on the BUYER''S side. sold_broker_contact_id is ours (the listing agent); a sale has two sides and one column could only ever hold one.';

create index idx_projects_sold_to_contact on public.projects(sold_to_contact_id) where sold_to_contact_id is not null;

-- THE HANDOVER. Idempotent: run it again after the buyer signs up and the only
-- thing that changes is that he finally gets the login-level ownership.
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
  v_seller_user uuid; v_seller_contact uuid;
  v_kids int := 0; v_punch int := 0; k record;
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

  -- 1. The sale, on the property itself.
  update public.projects
     set sold_to_contact_id = p_buyer_contact,
         sold_to = coalesce(nullif(btrim(coalesce(sold_to,'')),''), coalesce(v_buyer.person_name, v_buyer.name)),
         sold_date = coalesce(p_sold_date, sold_date, current_date),
         sold_amount = coalesce(p_sold_amount, sold_amount),
         sold_buyer_broker_contact_id = coalesce(p_buyer_broker_contact, sold_buyer_broker_contact_id),
         last_modified_by = 'project_hand_over'
   where id = p_project;

  -- 2. The buyer is the asset owner, of the house and of every job under it.
  --    A contact with no login gets the seat anyway - rulebook 15: a login is an
  --    attribute, not the price of admission. It grants nothing until he has one.
  for k in select id from public.project_ancestry_down(p_project) loop
    insert into public.project_members (project_id, contact_id, app_user_id, role, project_role, status, accepted_at,
                                        can_view_financials, can_edit_scope, can_invite, can_hire, notes)
    values (k.id, p_buyer_contact, v_buyer_user, 'owner', 'asset owner', 'active', now(),
            true, true, true, true, 'Bought the property on ' || to_char(coalesce(p_sold_date, pr.sold_date, current_date), 'YYYY-MM-DD') || ' (project_hand_over).')
    on conflict do nothing;
    v_kids := v_kids + 1;
  end loop;

  -- 3. Login-level ownership moves only when the buyer HAS a login. Until then the
  --    row stays with the seller and the sold_date keeps it out of his home list.
  if v_buyer_user is not null then
    update public.projects set owner_user_id = v_buyer_user, last_modified_by = 'project_hand_over'
     where id in (select id from public.project_ancestry_down(p_project));
  end if;

  -- 4. THE PUNCH LIST. Open tasks are not closed and not reassigned: the buyer now
  --    owns them because he owns the house, and whoever holds each one still has to
  --    deliver it. The seller keeps his seat for exactly that reason.
  select count(*) into v_punch from public.actions a
   where a.project_id in (select id from public.project_ancestry_down(p_project))
     and a.status not in ('Completed','Cancelled','Force Cancelled');

  if v_seller_contact is not null and v_seller_contact is distinct from p_buyer_contact then
    insert into public.project_members (project_id, contact_id, app_user_id, role, project_role, status, accepted_at,
                                        can_view_financials, can_edit_scope, can_invite, can_hire, notes)
    values (p_project, v_seller_contact, v_seller_user, 'collaborator', 'site project manager', 'active', now(),
            true, false, false, false, 'Sold the property and still owes the punch list (project_hand_over).')
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'project_id', p_project, 'buyer_contact_id', p_buyer_contact,
                            'buyer_has_login', v_buyer_user is not null,
                            'projects_transferred', v_kids, 'open_punch_items', v_punch);
end
$fn$;

comment on function public.project_hand_over(uuid, uuid, date, numeric, uuid) is
'Sells a property to a buyer who is a CONTACT: records the sale, seats the buyer as asset owner on the house and every job under it, moves owner_user_id when the buyer has a login, and leaves the open punch list exactly where it is - the buyer owns it because he owns the house, the seller keeps a seat because he still has to deliver it. Idempotent; re-run after the buyer signs up to complete the login-level transfer.';

revoke all on function public.project_hand_over(uuid, uuid, date, numeric, uuid) from public, anon;
grant execute on function public.project_hand_over(uuid, uuid, date, numeric, uuid) to authenticated, service_role;
