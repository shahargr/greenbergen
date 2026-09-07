-- ============================================================================
-- Homeowner app, part 5: TWO READS THAT WERE PAYING FOR WHAT THEY THREW AWAY.
--
-- Measured on production before this change: Postgres answers every one of
-- these in single-digit milliseconds, but each call costs ~190 ms warm (700 ms
-- on a cold server) over the wire, so the payload is the thing worth cutting.
--
-- 1. homeowner_package(code) - one package's nested JSON. homeowner_booking()
--    was building the WHOLE 37 kB catalogue and keeping one package of the
--    seventeen. homeowner_catalogue() is now the aggregate of this function,
--    so the shape is defined once and cannot drift between the two.
--
-- 2. homeowner_tasks() - the open tasks the inbox actually draws. It was
--    calling portal_tasks(), which is shaped for the portal's table: whole
--    rows, notes and all, 52 kB for 60 tasks, to show four fields each.
--    This returns those fields and nothing else.
--
-- Additive: no table changes, no existing row touched. 003 carries the same
-- definitions, so a fresh apply of 001-005 is complete either way.
-- ============================================================================
begin;

-- ---------------------------------------------------------------- one package
create or replace function public.homeowner_package(p_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', p.code, 'name', p.name, 'tile_title', p.tile_title, 'tile_line2', p.tile_line2,
    'trade', p.trade, 'tile_group', p.tile_group, 'availability', p.availability,
    'base_price_cents', p.base_price_cents, 'config_label', p.config_label,
    'requires_permit', p.requires_permit, 'permit_deposit_pct', p.permit_deposit_pct,
    'instant_book', p.instant_book, 'approval_note', p.approval_note,
    'illustration', p.illustration, 'description', p.description, 'sort_order', p.sort_order,
    'items', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'detail', i.detail) order by i.sort_order)
                         from public.blueprint_package_items i where i.package_code = p.code), '[]'::jsonb),
    'levers', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', l.key, 'label', l.label, 'control', l.control, 'question', l.question,
                 'options', coalesce((select jsonb_agg(jsonb_build_object(
                     'key', o.key, 'label', o.label, 'price_delta_cents', o.price_delta_cents,
                     'is_default', o.is_default, 'chip', o.chip) order by o.sort_order)
                   from public.blueprint_package_lever_options o where o.lever_id = l.id), '[]'::jsonb))
                 order by l.sort_order)
               from public.blueprint_package_levers l where l.package_code = p.code), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('key', ph.key, 'label', ph.label, 'hint', ph.hint) order by ph.sort_order)
                         from public.blueprint_package_photos ph where ph.package_code = p.code), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', m.key, 'kind', m.kind, 'name', m.name, 'sequence_no', m.sequence_no,
                 'percent_of_contract', m.percent_of_contract, 'typical_range', m.typical_range,
                 'trigger_description', m.trigger_description) order by m.sequence_no)
               from public.blueprint_package_milestones m where m.package_code = p.code), '[]'::jsonb))
  from public.blueprint_packages p
  where p.code = p_code and p.is_active;
$$;
comment on function public.homeowner_package(text) is 'ONE package as the app draws it (items, levers with options, photos, milestones). homeowner_catalogue() is the aggregate of this, and homeowner_booking() reads the booked package through it instead of building all seventeen and keeping one.';

create or replace function public.homeowner_catalogue()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.homeowner_package(p.code) order by p.sort_order, p.name), '[]'::jsonb)
  from public.blueprint_packages p
  where p.is_active;
$$;
comment on function public.homeowner_catalogue() is 'The package catalogue as the homeowner app draws it - jsonb_agg of homeowner_package(), so one definition of a package''s shape. anon may call it: the grid is browsable before joining. Read-only; templates only.';

-- ---------------------------------------------------------------- the inbox's tasks
create or replace function public.homeowner_tasks(p_limit integer default 25)
returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select pm.project_id from public.project_members pm
     where pm.app_user_id = public.current_app_user_id() and pm.status = 'active'
    union
    select p.id from public.projects p where public.is_superadmin()
  ),
  open_tasks as (
    select a.id, a.action, a.status, a.target_date, a.project_id, p.project_name,
           a.assigned_to_contact_id
      from public.actions a
      join public.projects p on p.id = a.project_id and p.trashed_at is null
      join mine m on m.project_id = a.project_id
     where a.domain = 'construction'
       and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
     order by a.target_date asc nulls last
     limit greatest(coalesce(p_limit, 25), 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'action', coalesce(t.action, '(untitled)'), 'status', t.status,
    'target_date', t.target_date, 'project', t.project_name, 'project_id', t.project_id,
    'assignee', (select coalesce(c.person_name, c.name) from public.contacts c where c.id = t.assigned_to_contact_id)
  ) order by t.target_date asc nulls last), '[]'::jsonb)
  from open_tasks t;
$$;
comment on function public.homeowner_tasks(integer) is 'The OPEN construction tasks on the member''s projects, with only the fields the inbox draws: what it is, its state, when it is due, which project, who has it. portal_tasks() returns the whole row (notes and all) for the portal''s table - 52 kB for 60 tasks - and the inbox shows four fields, so it reads this instead.';

-- ---------------------------------------------------------------- booking detail
-- Only the 'package' line changes: one package instead of all seventeen.
create or replace function public.homeowner_booking(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
    'scope', coalesce((select jsonb_agg(jsonb_build_object('item', si.item, 'detail', si.owner_summary) order by si.created_at)
                        from public.project_scope_items si where si.project_id = p_project), '[]'::jsonb),
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
                              when a.created_by = 'system:package-blueprint' then 'milestone' else 'other' end,
                 'pending_reason', a.pending_reason, 'created_at', a.created_at) order by a.created_at)
               from public.actions a where a.project_id = p_project
                and a.status in ('Not Started','In Progress','Parked','Pending on Others','Completed Pending Approval','Completed Pending')), '[]'::jsonb)
  );
end $$;
comment on function public.homeowner_booking(uuid) is 'Everything the project view, folder and timeline need for one booking, in one call. budget_band and facts are returned only to the owner.';

-- ---------------------------------------------------------------- grants (rulebook 71)
revoke all on function public.homeowner_package(text) from public, anon, authenticated;
grant execute on function public.homeowner_package(text) to authenticated, service_role;
grant execute on function public.homeowner_package(text) to anon;  -- the catalogue is anon, and is built from it

revoke all on function public.homeowner_tasks(integer) from public, anon, authenticated;
grant execute on function public.homeowner_tasks(integer) to authenticated, service_role;

commit;
