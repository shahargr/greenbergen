-- 170: A TRADE JOINS THE JOB FROM ITS PANEL, AND ITS PACKAGE OPENS WITH IT.
--
-- Shahar (2026-09-17), on the Rough panel (Framing, Plumbing, Electrical):
-- "i want to start another trade on the job, roofing. how would i add it
-- here? i envision adding it, and then starting phase 1 designing the scope,
-- moving into vendor selection, delivery and inspection."
--
-- Two things were true and neither was reachable from that screen. A trade
-- joins a job's list the moment anything names it (164, project_trade_join),
-- and a BUILD task carries the four-step package - scope, selection, legal
-- and insurance, punch list and inspection (131, "Build - a trade package").
-- Nothing on the panel offered either; the only way in was the new-task
-- wizard, which asks nine questions to say "roofing".
--
-- So:
--   * portal_trade_catalogue(job) - every trade, with its stage, its panel,
--     and whether it is already on the job's list, so a picker can lead
--     with the trades of the panel you are standing in.
--   * portal_trade_add(job, trade) - joins the trade to the job and opens
--     its package: one BUILD task named for the trade, whose steps are the
--     phases he named. Idempotent: a trade already on the job with an open
--     package is handed back, not doubled.
--   * The package gains the phase he named that it lacked. "Delivery" sits
--     between the paperwork and the punch list: the work itself, on site,
--     photographed before, during and after (rulebook 14). The step insert
--     reaches the three packages already open (Internal stairs), by the
--     backfill trigger - a new stage reaches work already underway.

-- ---------------------------------------------------------------------------
-- The phase that was missing.
insert into public.blueprint_activity_steps
  (activity_blueprint_id, step_order, step_name, default_assigned_to, notes, necessity, cadence, action_type)
select b.id, 35, 'Delivery', null,
       'THE WORK ITSELF, on site. Before anybody starts: the BEFORE photographs from a '
    || 'vantage point you can stand in again. While it is open: the DURING shots of '
    || 'everything that will be covered - rough-in, membrane, flashing, blocking - because '
    || 'this is the only day they can be taken. When they say they are done: the AFTER, '
    || 'same vantage. Log the site visits against this step, and the payments against '
    || 'the contract as each milestone is met. This step closes when the trade says the '
    || 'work is complete; whether it IS complete is the next step''s question.',
       'required', 'one-time', 'build'
  from public.blueprint_activity b
 where b.name = 'Build - a trade package'
   and not exists (select 1 from public.blueprint_activity_steps s
                    where s.activity_blueprint_id = b.id and s.step_name = 'Delivery');

-- ---------------------------------------------------------------------------
-- THE CATALOGUE, SEEN FROM ONE JOB. on_job is true when the trade is on the
-- list of this project or any project beneath it, so a picker opened on a
-- property (55 Walnut Drive) knows what its jobs already carry.
create or replace function public.portal_trade_catalogue(p_project uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not (public.is_project_member(p_project) or public.is_superadmin()) then '[]'::jsonb
  else coalesce((
    select jsonb_agg(jsonb_build_object(
             'trade', t.trade,
             'stage', t.stage,
             'panel', coalesce(s.panel, t.stage, 'Running the job'),
             'panel_order', coalesce(s.sort_order, 999),
             'on_job', exists (select 1 from public.project_bid_needs n
                                where n.trade = t.trade
                                  and n.project_id in (select f.id from public.project_ancestry_down(p_project) f)))
           order by coalesce(s.sort_order, 999), t.sort_order, t.trade)
      from public.trades t
      left join public.trade_stages s on s.stage = t.stage
     where t.trade not in ('ALL', 'Meta')), '[]'::jsonb) end;
$$;
revoke all on function public.portal_trade_catalogue(uuid) from public, anon;
grant execute on function public.portal_trade_catalogue(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ADD A TRADE AND OPEN ITS PACKAGE.
create or replace function public.portal_trade_add(p_project uuid, p_trade text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_trade   text;
  v_joined  boolean;
  v_pkg     uuid;
  v_steps   integer;
  r         jsonb;
begin
  perform public.assert_own_hands();
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED',
      'reason', 'Only somebody who runs this job can add a trade to it.');
  end if;
  -- A property holds no work; its jobs do (fn_actions_not_on_property).
  if not public.portal_task_takes_tasks(p_project) then
    return jsonb_build_object('ok', false, 'code', 'IS_PROPERTY',
      'reason', 'This is the property, not a job. Add the trade on the job beneath it.');
  end if;

  select tr.trade into v_trade from public.trades tr
   where lower(tr.trade) = lower(trim(coalesce(p_trade, ''))) limit 1;
  if v_trade is null then
    return jsonb_build_object('ok', false, 'code', 'NO_TRADE',
      'reason', format('"%s" is not a trade we know.', p_trade));
  end if;

  v_joined := public.project_trade_join(p_project, v_trade, 'the panel screen');

  -- One open package per trade per job. A second "Roofing" package is the
  -- mistake the Internal stairs triplet already made by hand.
  select a.id, (select count(*) from public.actions c where c.parent_action_id = a.id)
    into v_pkg, v_steps
    from public.actions a
   where a.project_id = p_project
     and a.trade = v_trade
     and a.action_type = 'build'
     and a.parent_action_id is null
     and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
   order by a.created_at
   limit 1;
  if v_pkg is not null then
    return jsonb_build_object('ok', true, 'trade', v_trade, 'id', v_pkg, 'steps', v_steps,
                              'joined', v_joined, 'existed', true);
  end if;

  r := public.portal_task_create(
    p_project  => p_project,
    p_action   => v_trade,
    p_type     => 'build',
    p_delivers => 'work',
    p_trade    => v_trade,
    p_priority => 'Medium',
    p_description =>
      format('%s on this job, start to finish: the scope in writing, choosing who does it, '
          || 'the paperwork that has to exist before anybody is on site, the work itself, '
          || 'and the punch list and inspection that close it out. Each is a step beneath this.',
             v_trade));
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;

  return r || jsonb_build_object('trade', v_trade, 'joined', v_joined, 'existed', false);
end $$;
revoke all on function public.portal_trade_add(uuid, text) from public, anon;
grant execute on function public.portal_trade_add(uuid, text) to authenticated;

comment on function public.portal_trade_add(uuid, text) is
  'Adds a trade to a job''s list and opens its BUILD package (the trade''s phases as steps). Idempotent per trade per job. Migration 170.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
