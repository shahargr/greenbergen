-- ============================================================================
-- 008: NOBODY SEES THE ADDRESS UNTIL THE BID IS AWARDED. THE TOWN IS FINE.
--
-- A standing rule of the community, not a preference of one screen: a
-- contractor who has been invited to bid - or who bid and lost - is told the
-- TOWN and nothing more. The street line arrives when the job is theirs.
-- Towns are deliberately allowed: permits, travel and licensing all need one.
--
-- Two functions were handing it over before award, both SECURITY DEFINER, so
-- row-level security never got a say:
--
--   portal_my_bid_projects()  returned 'address', p.address for every project
--                             the contact had a bid on, at any status.
--   portal_bid(bid)           returned project_parent_name - the home the job
--                             hangs under, whose NAME is the street line
--                             ('52 Ryerson'), so the address leaked through
--                             the label even though no address column did.
--
-- Fixing it in the app would have fixed one screen. The gate belongs here,
-- where every app - the portal, the homeowner app, the contractor app that
-- does not exist yet - has to pass through it.
--
-- bid_may_see_address(project) is the one test: you manage the project, you
-- are seated on it, you won the bid, or you hold its contract. Everyone else
-- gets project_town() and a label that cannot give the street away.
--
-- Additive: no table changed, no row touched. Two functions get narrower.
-- ============================================================================
begin;

-- --------------------------------------------------------------- the gate
create or replace function public.bid_may_see_address(p_project uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_project is not null and (
    -- The owner's side of the table, and anyone actually seated on the job.
    public.is_superadmin()
    or public.bid_can_manage(p_project)
    or public.is_project_member(p_project)
    -- The bidder who won it.
    or exists (select 1 from public.bids b
                where b.project_id = p_project
                  and b.bidder_contact_id = public.bid_my_contact()
                  and (b.won or b.status = 'awarded'))
    -- Or who is already under contract on it, bid or no bid.
    or exists (select 1 from public.contracts c
                where c.project_id = p_project
                  and c.contractor_id = public.bid_my_contact()
                  and lower(c.status) in ('awarded','signed','active','complete')));
$$;
comment on function public.bid_may_see_address(uuid) is 'THE address rule: the street line is visible only to someone who manages the project, is seated on it, won its bid, or holds its contract. An invited or losing bidder is told the town instead (project_town). Every read that returns an address to a contractor goes through this.';

revoke all on function public.bid_may_see_address(uuid) from public, anon;
grant execute on function public.bid_may_see_address(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- the town
-- The job itself carries the address on the homeowner app; a portal project
-- may hang under the home that does. Walk up until one has an address.
create or replace function public.project_town(p_project uuid)
returns text
language sql stable security definer set search_path = public as $$
  select nullif(btrim(split_part(p.address, ',', 2)), '')
    from public.project_ancestry(p_project) a
    join public.projects p on p.id = a.project_id
   where nullif(btrim(coalesce(p.address, '')), '') is not null
   limit 1;
$$;
comment on function public.project_town(uuid) is 'The town of a project or of the nearest ancestor that has an address - what a bidder is told instead of the street line. Bergen towns are public information and permits need one.';

revoke all on function public.project_town(uuid) from public, anon;
grant execute on function public.project_town(uuid) to authenticated, service_role;

-- --------------------------------------------------------------- the label
-- A project's own name is usually safe ('Water heater replacement'), but a
-- project named after its house is not. When the name repeats the street
-- line, the trade or package stands in for it.
-- The viewer-independent half: what this project may be CALLED in front of
-- someone who has not been awarded it. Split out because a trigger composing
-- a notification has no viewer to test - it must be safe for whoever reads it.
create or replace function public.project_label_no_address(p_project uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare v_name text; v_street text; v_alt text;
begin
  select p.project_name into v_name from public.projects p where p.id = p_project;
  if v_name is null then return null; end if;

  select nullif(btrim(split_part(p.address, ',', 1)), '') into v_street
    from public.project_ancestry(p_project) a
    join public.projects p on p.id = a.project_id
   where nullif(btrim(coalesce(p.address, '')), '') is not null
   limit 1;
  if v_street is null or position(lower(v_street) in lower(v_name)) = 0 then
    return v_name;
  end if;

  -- The name gives the street away. Say what the work IS instead.
  select coalesce(bp.name, bpk.trade) into v_alt
    from public.bid_packages bpk
    left join public.project_bookings b on b.project_id = p_project
    left join public.blueprint_packages bp on bp.code = b.package_code
   where bpk.project_id = p_project
   order by bpk.created_at desc limit 1;
  return coalesce(v_alt, 'A job in ' || coalesce(public.project_town(p_project), 'Bergen County'));
end $$;
comment on function public.project_label_no_address(uuid) is 'What a project may be called in front of someone not entitled to its address: its own name, unless that name repeats the street line (a project called after its house), in which case the package or trade stands in. Viewer-independent, so a trigger composing a notification can use it.';

revoke all on function public.project_label_no_address(uuid) from public, anon;
grant execute on function public.project_label_no_address(uuid) to authenticated, service_role;

-- And the viewer-aware wrapper the bid reads use.
create or replace function public.bid_safe_label(p_project uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case when public.bid_may_see_address(p_project)
              then (select p.project_name from public.projects p where p.id = p_project)
              else public.project_label_no_address(p_project) end;
$$;
comment on function public.bid_safe_label(uuid) is 'The project name a bidder may see: its real name once they are entitled to the address, project_label_no_address until then.';

revoke all on function public.bid_safe_label(uuid) from public, anon;
grant execute on function public.bid_safe_label(uuid) to authenticated, service_role;

-- ------------------------------------------------- the invitation itself
-- The message a bidder receives named the project. For a project called
-- after its house that IS the address, and a stored message cannot be
-- filtered at read time - so it is composed safely in the first place.
-- The award message may use the real name: by then the job is theirs.
create or replace function public.fn_bids_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_project text; v_real text; v_body text; v_from uuid;
begin
  select public.project_label_no_address(new.project_id) into v_project;
  select p.project_name into v_real from projects p where p.id = new.project_id;
  select ct.id into v_from from contacts ct
    join app_users u on u.contact_id = ct.id
   where u.id = (select owner_user_id from projects where id = new.project_id);

  if tg_op = 'INSERT' and new.status = 'invited' then
    v_body := 'You are invited to bid on ' || coalesce(v_project, 'a project')
              || coalesce(' in ' || public.project_town(new.project_id), '')
              || coalesce(' - ' || nullif(new.trade, ''), '') || '.'
              || coalesce(chr(10) || new.scope_summary, '')
              || chr(10) || 'The address is shared if the job is awarded to you.';
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'awarded' or new.won then
      v_body := 'Your bid on ' || coalesce(v_real, 'a project') || ' was awarded. Congratulations.';
    elsif new.status = 'not awarded' then
      v_body := 'Your bid on ' || coalesce(v_project, 'a project') || ' was not awarded this time.';
    elsif new.status = 'under negotiation' then
      v_body := 'Your bid on ' || coalesce(v_project, 'a project') || ' is being negotiated - check the package.';
    else
      return new;
    end if;
  else
    return new;
  end if;

  if new.bidder_contact_id is not null then
    insert into messages (body, direction, channel, status, sent_at,
                          project_id, from_contact_id, to_contact_id, contractor_id, created_by)
    values (v_body, 'inbound', 'in app', 'new', now(),
            new.project_id, v_from, new.bidder_contact_id, new.bidder_contact_id, 'trigger:bids');
  end if;
  return new;
end $$;
comment on function public.fn_bids_notify() is 'Tells a bidder their bid was invited, awarded, passed over or reopened. The invitation and the not-awarded note carry project_label_no_address and the TOWN, never the street line - a stored message cannot be filtered when it is read, so it is composed safely. Only the award message uses the project''s real name: by then the job is theirs.';

-- ------------------------------------------------- the two reads, narrowed
-- Only the address, town, name and parent_name lines change; everything else
-- is carried over as it was.
create or replace function public.portal_my_bid_projects()
returns jsonb
language sql stable security definer set search_path = public as $function$
  with me as (select contact_id from public.app_users where id = public.current_app_user_id())
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', p.id,
    'project_name', public.bid_safe_label(p.id),
    -- The rule. Town always; street line only once it is theirs.
    'address', case when public.bid_may_see_address(p.id) then p.address end,
    'town', public.project_town(p.id),
    'may_see_address', public.bid_may_see_address(p.id),
    'status', p.status,
    'parent_name', case when public.bid_may_see_address(p.id)
                        then (select pp.project_name from public.projects pp where pp.id = p.parent_project_id) end,
    -- Who owes the next move.
    'kind', case
              when x.awarded then 'awarded'
              when x.pending_you then 'pending you'
              when x.pending_customer then 'pending customer'
              else 'not awarded' end,
    'bids', x.n_bids, 'latest_bid_id', x.latest_bid_id, 'amount', x.amount
  ) order by (case when x.awarded then 0 when x.pending_you then 1 when x.pending_customer then 2 else 3 end), p.project_name), '[]'::jsonb)
  from (
    select b.project_id,
           bool_or(b.won or b.status = 'awarded') as awarded,
           bool_or(b.status = 'invited') as pending_you,
           bool_or(b.status in ('received','under negotiation')) as pending_customer,
           count(*) as n_bids,
           (array_agg(b.id order by b.created_at desc))[1] as latest_bid_id,
           max(b.amount) as amount
      from public.bids b, me where b.bidder_contact_id = me.contact_id group by b.project_id
    union all
    select c.project_id, true, false, false, 0, null, max(c.amount_original)
      from public.contracts c, me
     where c.contractor_id = me.contact_id and lower(c.status) in ('awarded','signed','active','complete')
       and not exists (select 1 from public.bids b where b.bidder_contact_id = me.contact_id and b.project_id = c.project_id)
     group by c.project_id
  ) x
  join public.projects p on p.id = x.project_id
  where p.trashed_at is null;
$function$;
comment on function public.portal_my_bid_projects() is 'Every project the signed-in contact has bid on or holds a contract for, with who owes the next move. The address is returned ONLY where bid_may_see_address says so (awarded, seated, or managing); everyone else gets town and a name that cannot give the street away.';

create or replace function public.portal_bid(p_bid uuid)
returns jsonb
language sql stable security definer set search_path = public as $function$
  select case when b.id is null or not (public.bid_can_manage(b.project_id) or b.bidder_contact_id = public.bid_my_contact()) then null
  else jsonb_build_object(
    'id', b.id, 'status', b.status, 'amount', b.amount, 'valid_until', b.valid_until, 'notes', b.notes,
    'received_on', b.received_on, 'line_items', b.line_items, 'terms_reply', b.terms_reply, 'insurance_reply', b.insurance_reply,
    'bidder', (select coalesce(c.person_name, c.name) from contacts c where c.id = b.bidder_contact_id),
    'can_reply', (b.bidder_contact_id = public.bid_my_contact() and bp.status = 'open' and b.status in ('invited','received','under negotiation')),
    'can_manage', public.bid_can_manage(b.project_id),
    'package', jsonb_build_object(
      'id', bp.id, 'project_id', bp.project_id,
      -- The rule, again: a label that cannot carry the street, the town
      -- always, and the address and the house's own name only after award.
      'project_name', public.bid_safe_label(bp.project_id),
      'town', public.project_town(bp.project_id),
      'may_see_address', public.bid_may_see_address(bp.project_id),
      'address', case when public.bid_may_see_address(bp.project_id)
                      then (select p.address from projects p where p.id = bp.project_id) end,
      'project_parent_id', (select p.parent_project_id from projects p where p.id = bp.project_id),
      'project_parent_name', case when public.bid_may_see_address(bp.project_id)
                                  then (select pp.project_name from projects p join projects pp on pp.id = p.parent_project_id where p.id = bp.project_id) end,
      'phase', bp.phase, 'category', bp.category, 'trade', bp.trade, 'scope_summary', bp.scope_summary, 'reply_by', bp.reply_by, 'status', bp.status,
      'budget_amount', case when bp.budget_visible then bp.budget_amount end,
      'deposit_pct', bp.deposit_pct, 'retainage_pct', bp.retainage_pct, 'retainage_release_trigger', bp.retainage_release_trigger,
      'net_days', bp.net_days, 'consumables_by', bp.consumables_by, 'finish_material_by', bp.finish_material_by,
      'insurance_gl_per_occurrence', bp.insurance_gl_per_occurrence, 'insurance_gl_aggregate', bp.insurance_gl_aggregate,
      'insurance_workers_comp', bp.insurance_workers_comp, 'coi_required', bp.coi_required,
      'items', coalesce((select jsonb_agg(jsonb_build_object('scope_item_id', i.scope_item_id, 'item', s.item, 'is_required', i.is_required) order by i.sort, s.item)
                 from bid_package_items i join project_scope_items s on s.id = i.scope_item_id where i.package_id = bp.id), '[]'::jsonb),
      'docs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'kind', f.kind, 'bucket', f.bucket, 'path', f.path) order by f.created_at desc)
                 from file_links fl join files f on f.id = fl.file_id where fl.bid_package_id = bp.id), '[]'::jsonb)),
    'docs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'kind', f.kind, 'bucket', f.bucket, 'path', f.path) order by f.created_at desc)
                 from file_links fl join files f on f.id = fl.file_id where fl.bid_id = b.id), '[]'::jsonb)
  ) end
  from bids b join bid_packages bp on bp.id = b.package_id where b.id = p_bid;
$function$;
comment on function public.portal_bid(uuid) is 'One bid as its bidder or the project''s manager sees it. The street line and the house''s own name are withheld until bid_may_see_address is true (awarded, seated, or managing); the town is always given, because permits and travel need one.';

commit;
