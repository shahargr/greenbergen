-- 031 - a home has a face, a home has people, and DIY has steps.
--
-- Three of Shahar's asks in one migration, because they are three reads of
-- the same screen: the home.
--
--   1. A photo on each home. He is right that nothing new is needed to
--      STORE one - homeowner_photo_add already writes any project's photo
--      through record_project_file, and a home container is a project. What
--      was missing is the READ: homeowner_me() hands the app its homes and
--      had no way to say "this one has a picture". One field fixes it.
--
--   2. Invite someone to a PROPERTY with a role. portal_invite_to_project
--      already invites to any project and a home IS a project - but its seat
--      map knew three seats and collapsed everything else to viewer. A
--      property manager landed as a viewer, which is the opposite of the
--      job. The ladder already had the right rung.
--
--   3. On a DIY project the scope list is not a list of what you are buying,
--      it is a list of what you are DOING. Same rows, different reading -
--      except for two of them, which are not work at all.
--
-- WHY A kind COLUMN AND NOT A LIST IN THE APP (rulebook 03: a vocabulary is
-- a table). Every package's scope ends with "Insurance coverage" and
-- "Warranty". Those are not steps - they are what the CONTRACTOR carries,
-- and on a DIY job nobody carries them. The app must be able to tell the
-- two apart, and the honest place for that distinction is the catalogue
-- row, not an `if (label === 'Warranty')` buried in a component.

-- ---------------------------------------------------------------------
-- 1. A scope line is work, or it is an assurance.
-- ---------------------------------------------------------------------
alter table public.blueprint_package_items
  add column if not exists kind text not null default 'work';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'blueprint_package_items_kind_check') then
    alter table public.blueprint_package_items
      add constraint blueprint_package_items_kind_check check (kind in ('work', 'assurance'));
  end if;
end $$;

comment on column public.blueprint_package_items.kind is
  'What this scope line IS. work = something someone does to the house, and so a step you could do yourself; assurance = something the contractor carries and a DIY owner does not get (insurance, the warranty). The homeowner app reads it to turn "What''s included" into "Suggested steps" on a DIY project, and to say plainly what turn-key adds. Everything is work unless said otherwise.';

-- The two assurances every package ends with. Matched on label because that
-- is what they are - the seed writes the same two lines into every package.
update public.blueprint_package_items
   set kind = 'assurance'
 where label in ('Insurance coverage', 'Warranty');

-- ---------------------------------------------------------------------
-- 2. homeowner_booking: every scope line says which kind it is.
-- ---------------------------------------------------------------------
-- The scope on a job is a COPY (rulebook 41) and stays the authority on what
-- was agreed; kind is display enrichment resolved back through `source`,
-- which homeowner_book already stamps as 'blueprint_packages.<code>'. If a
-- catalogue label is ever reworded the join simply misses and the line reads
-- as work - the safe way to be wrong, and never a change to what was agreed.
create or replace function public.homeowner_booking(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare b public.project_bookings; pr public.projects; my_contact uuid := public.my_contact_id(); v_is_owner boolean;
begin
  if not public.is_project_member(p_project) then return null; end if;
  select * into b from public.project_bookings where project_id = p_project;
  if b.id is null then return null; end if;
  select * into pr from public.projects where id = p_project;
  v_is_owner := (pr.owner_user_id = public.current_app_user_id()) or public.is_superadmin();

  return jsonb_build_object(
    'project_id', b.project_id, 'home_project_id', b.home_project_id, 'package_code', b.package_code,
    'package', public.homeowner_package(b.package_code),
    'address', pr.address, 'unit', b.unit, 'project_status', pr.status,
    'price_cents', b.price_cents, 'base_price_cents', b.base_price_cents, 'selections', b.selections, 'config_label', b.config_label,
    'facts', case when v_is_owner then b.facts end, 'budget_band', case when v_is_owner then b.budget_band end, 'note', b.note,
    'state', b.state, 'created_at', b.created_at, 'posted_at', b.posted_at, 'target_window', b.target_window, 'reply_by', b.reply_by, 'repost_count', b.repost_count, 'offered_count', b.offered_count,
    'live_price_cents', case when b.state = 'planned' then (select price_cents from public.homeowner_price(b.package_code, b.selections)) end,
    'accepted_at', b.accepted_at, 'closed_at', b.closed_at, 'close_reason', b.close_reason, 'done_at', b.done_at,
    'no_taker', (b.state = 'posted' and b.reply_by is not null and b.reply_by < now()),
    'photos', public.homeowner_photos(p_project),
    'is_owner', v_is_owner, 'my_contact_id', my_contact,
    'share', jsonb_build_object('slug', b.share_slug, 'shared_at', b.shared_at, 'quote', b.share_quote, 'hide_address', b.share_hide_address, 'after_file_id', b.share_after_file_id),
    'owner', (select jsonb_build_object('contact_id', u.contact_id, 'name', u.full_name) from public.app_users u where u.id = pr.owner_user_id),
    'contractor', case when b.contractor_contact_id is null then null else (
       select jsonb_build_object('contact_id', c.id, 'name', coalesce(co.company_name, c.person_name, c.name),
                                 'person', coalesce(c.person_name, c.name), 'phone', coalesce(c.phone, co.main_phone),
                                 'email', c.email_a, 'license', co.license_number,
                                 'insured', exists (select 1 from public.insurance_certificates ic where (ic.contractor_id = c.id or ic.company_id = co.id) and (ic.expiry_date is null or ic.expiry_date >= current_date)),
                                 'insurance', (select jsonb_build_object('coverage', ic.coverage_type, 'limit', ic.each_occurrence_limit, 'expires', ic.expiry_date)
                                                 from public.insurance_certificates ic where (ic.contractor_id = c.id or ic.company_id = co.id) order by ic.expiry_date desc nulls last limit 1),
                                 'rating', case when co.id is null then null else public.contractor_rating(co.id) end,
                                 'jobs', (select count(*) from public.project_bookings x where x.contractor_contact_id = c.id and x.state in ('accepted','done')))
         from public.contacts c left join public.companies co on co.id = c.company_id where c.id = b.contractor_contact_id) end,
    'progress', public.homeowner_progress(p_project),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'sequence_no', s.sequence_no,
                 'amount_cents', (coalesce(s.amount,0)*100)::bigint, 'percent', s.percent_of_contract, 'status', s.status,
                 'settlement_status', s.settlement_status, 'paid_at', s.paid_at, 'approved_at', s.approved_at, 'trigger', s.trigger_description,
                 'evidence', coalesce((select jsonb_agg(jsonb_build_object('file_id', f.id, 'path', f.path, 'kind', f.kind))
                                        from public.file_links fl join public.files f on f.id = fl.file_id where fl.payment_stage_id = s.id), '[]'::jsonb))
                 order by s.sequence_no) from public.payment_stages s where s.project_id = p_project), '[]'::jsonb),
    'scope', coalesce((select jsonb_agg(jsonb_build_object(
                          'item', si.item, 'detail', si.owner_summary,
                          'kind', coalesce(bi.kind, 'work')) order by si.created_at)
                        from public.project_scope_items si
                        left join public.blueprint_package_items bi
                               on si.source = 'blueprint_packages.' || bi.package_code
                              and bi.label = si.item
                       where si.project_id = p_project), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'path', f.path, 'bucket', f.bucket, 'kind', f.kind, 'mime', f.mime_type,
                 'caption', f.caption, 'created_at', f.created_at, 'by_me', f.uploaded_by_user_id = public.current_app_user_id(),
                 'by', coalesce(u.full_name, u.email), 'role', (select fl.role from public.file_links fl where fl.file_id = f.id and fl.project_id = p_project limit 1))
                 order by f.created_at desc)
               from public.files f left join public.app_users u on u.id = f.uploaded_by_user_id
              where f.project_id = p_project and f.is_latest), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'sent_at', m.sent_at,
                 'mine', m.from_contact_id = my_contact, 'system', m.from_contact_id is null,
                 'who', coalesce((select coalesce(c.person_name, c.name) from public.contacts c where c.id = m.from_contact_id), m.sender, 'Green Bergen'),
                 'read_at', m.read_at, 'file_id', m.file_id,
                 'file', case when m.file_id is null then null else (select jsonb_build_object('path', f.path, 'kind', f.kind, 'mime', f.mime_type) from public.files f where f.id = m.file_id) end)
                 order by m.sent_at)
               from public.messages m where m.project_id = p_project and m.channel = 'in app'), '[]'::jsonb),
    'unread', (select count(*) from public.messages m where m.project_id = p_project and m.to_contact_id = my_contact and m.read_at is null),
    'open_tasks', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'status', a.status,
                 'kind', case when a.source like 'system:transaction:%' then 'payment_confirmation'
                              when a.created_by = 'system:photo-request' then 'photos'
                              when a.created_by = 'system:package-blueprint' then 'milestone' else 'other' end,
                 'pending_reason', a.pending_reason, 'created_at', a.created_at) order by a.created_at)
               from public.actions a where a.project_id = p_project
                and a.status in ('Not Started','In Progress','Parked','Pending on Others','Completed Pending Approval','Completed Pending')), '[]'::jsonb)
  );
end $function$;

revoke all on function public.homeowner_booking(uuid) from public, anon;
grant execute on function public.homeowner_booking(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. homeowner_me: every home carries its picture and its people.
-- ---------------------------------------------------------------------
-- photo is the newest photo filed against the home CONTAINER, not against a
-- job under it - a job's photos are of a water heater, not of the house.
-- people is who else is on the home, so the card can say "you + 2" without a
-- second round trip; the owner is excluded because the owner is reading it.
create or replace function public.homeowner_me()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare me uuid := public.current_app_user_id(); u public.app_users; v_home public.projects;
begin
  if me is null then return jsonb_build_object('signed_in', false); end if;
  select * into u from public.app_users where id = me;
  select * into v_home from public.projects p
   where p.id in (select public.homeowner_home_ids(me))
   order by (select count(*) from public.project_bookings b where b.home_project_id = p.id and b.state in ('posted','accepted')) desc, p.created_at limit 1;

  return jsonb_build_object(
    'signed_in', true,
    'profile', jsonb_build_object('app_user_id', u.id, 'full_name', u.full_name, 'email', u.email,
                                  'home_zip', u.home_zip, 'home_town', u.home_town, 'contact_id', u.contact_id,
                                  'is_superadmin', u.is_superadmin),
    'home', case when v_home.id is null then null else jsonb_build_object(
              'project_id', v_home.id, 'address', v_home.address, 'name', v_home.project_name,
              'facts', (select b.facts from public.project_bookings b where b.home_project_id = v_home.id and b.facts is not null order by b.created_at desc limit 1)) end,
    -- Every home the member owns, with what is happening on each. Order:
    -- the one with live work first, then oldest first.
    'homes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', h.id, 'address', h.address, 'name', h.project_name, 'town', nullif(btrim(split_part(h.address, ',', 2)), ''), 'created_at', h.created_at,
        'facts', (select b.facts from public.project_bookings b where b.home_project_id = h.id and b.facts is not null order by b.created_at desc limit 1),
        'live', (select count(*) from public.project_bookings b join public.projects j on j.id = b.project_id where b.home_project_id = h.id and j.trashed_at is null and b.state in ('posted','accepted')),
        'planned', (select count(*) from public.project_bookings b join public.projects j on j.id = b.project_id where b.home_project_id = h.id and j.trashed_at is null and b.state = 'planned'),
        'done', (select count(*) from public.project_bookings b join public.projects j on j.id = b.project_id where b.home_project_id = h.id and j.trashed_at is null and b.state = 'done'),
        -- The face of the house: newest photo on the container itself.
        'photo', (select jsonb_build_object('file_id', f.id, 'path', f.path)
                    from public.files f
                   where f.project_id = h.id and f.kind = 'photo' and f.is_latest
                   order by f.created_at desc limit 1),
        -- Who else is on it, and who is still only invited.
        'people', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', coalesce(pu.full_name, pc.person_name, pc.name, pu.email, 'Someone'),
            'role', coalesce(pm.project_role, pm.role), 'status', pm.status) order by coalesce(pr2.authority_rank, 0) desc)
            from public.project_members pm
            left join public.app_users pu on pu.id = pm.app_user_id
            left join public.contacts pc on pc.id = pm.contact_id
            left join public.project_roles pr2 on pr2.role = coalesce(pm.project_role, pm.role)
           where pm.project_id = h.id and pm.status = 'active'
             and pm.app_user_id is distinct from me), '[]'::jsonb),
        'invited', (select count(*) from public.app_invitations ai
                     where ai.project_id = h.id and ai.status = 'pending' and ai.expires_at > now())
      ) order by (select count(*) from public.project_bookings b where b.home_project_id = h.id and b.state in ('posted','accepted')) desc, h.created_at)
      from public.projects h
      where h.id in (select public.homeowner_home_ids(me))), '[]'::jsonb),
    'home_quota', (
      select jsonb_build_object('allowed', c.assets_allowed,
        'have', (select count(*) from public.projects p where p.owner_user_id = me and p.parent_project_id is null and coalesce(p.is_template,false) = false),
        'can_add', public.may_create_asset())
        from public.contracts c where c.id = public.live_customer_agreement(me)),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', b.project_id, 'package_code', b.package_code, 'name', bp.name, 'tile_title', bp.tile_title,
        'illustration', bp.illustration, 'requires_permit', bp.requires_permit, 'instant_book', bp.instant_book,
        'address', p.address, 'home_project_id', b.home_project_id, 'price_cents', b.price_cents, 'config_label', b.config_label,
        'state', b.state, 'created_at', b.created_at, 'posted_at', b.posted_at, 'target_window', b.target_window, 'reply_by', b.reply_by, 'accepted_at', b.accepted_at,
        'closed_at', b.closed_at, 'done_at', b.done_at, 'repost_count', b.repost_count, 'offered_count', b.offered_count,
        'no_taker', (b.state = 'posted' and b.reply_by is not null and b.reply_by < now()),
        -- The photo request, for the banner: how many are still wanted and the
        -- open task that asks for them. Null action_id means nothing to nag about.
        'photos_needed', case when b.state in ('posted','accepted') then public.homeowner_photos_outstanding(b.project_id) else 0 end,
        'photos_action_id', (select a.id from public.actions a
                              where a.project_id = b.project_id and a.source = 'homeowner_app' and a.scope_milestone = 'photos'
                                and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded') limit 1),
        'share_slug', case when b.shared_at is not null then b.share_slug end,
        'contractor', case when b.contractor_contact_id is null then null else (
           select jsonb_build_object('contact_id', c.id, 'name', coalesce(co.company_name, c.person_name, c.name),
                                     'person', coalesce(c.person_name, c.name), 'phone', coalesce(c.phone, co.main_phone))
             from public.contacts c left join public.companies co on co.id = c.company_id where c.id = b.contractor_contact_id) end,
        'progress', public.homeowner_progress(b.project_id),
        'unread', (select count(*) from public.messages m where m.project_id = b.project_id and m.to_contact_id = u.contact_id and m.read_at is null),
        'last_message', (select jsonb_build_object('body', left(m.body, 140), 'sent_at', m.sent_at, 'mine', m.from_contact_id = u.contact_id,
                                                   'who', coalesce((select coalesce(c.person_name, c.name) from public.contacts c where c.id = m.from_contact_id), m.sender, 'Green Bergen'))
                           from public.messages m where m.project_id = b.project_id and m.channel = 'in app' order by m.sent_at desc limit 1)
      ) order by (b.state = 'closed'), (b.state = 'done'), (b.state = 'planned'), b.created_at desc)
      from public.project_bookings b
      join public.blueprint_packages bp on bp.code = b.package_code
      join public.projects p on p.id = b.project_id
      where p.trashed_at is null and public.is_project_member(b.project_id)), '[]'::jsonb)
  );
end $function$;

revoke all on function public.homeowner_me() from public, anon;
grant execute on function public.homeowner_me() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Four seats, not three.
-- ---------------------------------------------------------------------
-- A property is a project, so this function already invited people to one.
-- What it could not do was say WHAT they are. Anything it did not recognise
-- became a viewer, so "property manager" - the person you hand the house to
-- - arrived with read-only access, which is the opposite of the job.
--
-- 'manager' maps to site project manager (authority_rank 50), deliberately:
-- that is the same line my_doors() calls `manages` and bid_can_manage draws,
-- so a property manager gets the board in the experts app for exactly the
-- homes they were given, and nothing else. It needs no contract of its own
-- (seat_needs_contract already exempts it) because they are not selling you
-- a trade. The rank guard below is unchanged and still does the real work:
-- you cannot hand out a seat above your own, and an owner sits at 70.
create or replace function public.portal_invite_to_project(p_project uuid, p_email text default null::text, p_phone text default null::text, p_seat text default 'viewer'::text, p_note text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id();
  v_em text := nullif(lower(btrim(coalesce(p_email,''))), '');
  v_ph text := nullif(right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10), '');
  v_uid uuid; v_email text; v_name text;
  v_role text; v_prole text; my_rank int; new_rank int; v_id uuid;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Please sign in first.'); end if;
  if p_project is null then return jsonb_build_object('ok', false, 'reason', 'Pick a project.'); end if;
  if not (public.can_invite_to_project(p_project) or public.can_edit_project(p_project)) then
    return jsonb_build_object('ok', false, 'reason', 'You may not invite people to this project.');
  end if;
  if v_em is null and v_ph is null then
    return jsonb_build_object('ok', false, 'reason', 'Enter an email or a phone number.');
  end if;
  if v_ph is not null and length(v_ph) < 10 then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'Wrong user information provided — no account matches that email or phone.');
  end if;

  select u.id, u.email, coalesce(u.full_name, c.person_name, c.name, u.email)
    into v_uid, v_email, v_name
    from public.app_users u
    left join public.contacts c on c.id = u.contact_id
   where u.is_active
     and ((v_em is not null and lower(u.email) = v_em)
       or (v_ph is not null and (
             right(regexp_replace(coalesce(c.phone,''),   '\D', '', 'g'), 10) = v_ph
          or right(regexp_replace(coalesce(c.phone_2,''), '\D', '', 'g'), 10) = v_ph)))
   order by (v_em is not null and lower(u.email) = v_em) desc
   limit 1;
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'Wrong user information provided — no account matches that email or phone.');
  end if;
  if v_uid = me then return jsonb_build_object('ok', false, 'reason', 'That is your own account.'); end if;
  if exists (select 1 from public.project_members pm
              where pm.project_id = p_project and pm.app_user_id = v_uid and pm.status = 'active') then
    return jsonb_build_object('ok', false, 'reason', v_name || ' is already on this project.');
  end if;

  -- Seat → membership role + project role (authority ladder).
  case lower(coalesce(p_seat,'viewer'))
    when 'resident'   then v_role := 'owner';        v_prole := 'asset owner';
    when 'member'     then v_role := 'owner';        v_prole := 'asset owner';
    when 'manager'    then v_role := 'manager';      v_prole := 'site project manager';
    when 'contractor' then v_role := 'collaborator'; v_prole := 'contractor';
    else                   v_role := 'viewer';       v_prole := 'viewer';
  end case;
  if not public.is_superadmin() then
    select coalesce(authority_rank, 0) into new_rank from public.project_roles where role = v_prole;
    my_rank := public.my_authority_rank(p_project);
    if new_rank > coalesce(my_rank, 0) then
      return jsonb_build_object('ok', false, 'reason', 'You cannot grant a seat above your own.');
    end if;
  end if;

  -- One live invitation per person per project.
  update public.app_invitations set status = 'revoked'
   where project_id = p_project and invitee_user_id = v_uid and status = 'pending';

  insert into public.app_invitations
    (email, invitee_phone, invitee_name, invitee_user_id, project_id, role, project_role,
     invited_by_user_id, status, message, expires_at)
  values (v_email, p_phone, v_name, v_uid, p_project, v_role, v_prole,
          me, 'pending', nullif(btrim(coalesce(p_note,'')), ''), now() + interval '14 days')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'name', v_name);
end $function$;

comment on function public.portal_invite_to_project(uuid, text, text, text, text) is
  'Invite an existing member onto a project - a job or a HOME - with a seat. Seats: member/resident (asset owner, everything you can do), manager (site project manager, rank 50: runs the place and gets the board), contractor (holds an awarded scope), viewer (sees it, never the money). Anything unrecognised is a viewer. You can never grant a seat above your own.';

revoke all on function public.portal_invite_to_project(uuid, text, text, text, text) from public, anon;
grant execute on function public.portal_invite_to_project(uuid, text, text, text, text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
