-- 119. A STAGE IS A CLAIM. THE EVIDENCE CHECKS IT.
--
-- Shahar (2026-09-14): "logged in as home owner, tells me the generator is in
-- progress while in fact it isn't. check the logic showing in progress, under
-- way, etc... what values you should be showing me here?"
--
-- He is right and the fault is mine from this morning. I bucketed those rows
-- by projects.status, and projects.status is 'In Progress' on everything that
-- is not closed - it is the value a project is BORN with. Reporting a default
-- as a fact is how "Emergency generator" - no bid package, no bids, no tasks,
-- nobody on it, nothing ever done - came to say "Under way".
--
-- What I should have used is sitting right there: projects.stage, a foreign
-- key into engagement_stages, nine ordered rungs with descriptions somebody
-- wrote carefully (delivered: "Their claim only - you have not walked it and
-- the town has not seen it"). Every one of his jobs already carries a
-- sensible one.
--
-- BUT A STAGE IS ONLY WHAT SOMEBODY MEANT. Two of his rows prove it:
-- "Improvements" sits at stage 'active' - "Contractor mobilised and working
-- on site" - with nobody on it, no contract, no money and nothing finished.
-- "Emergency generator" sits at 'bid' - "seeking at least three bids" - with
-- no bid package ever issued. Both are intentions somebody set and then left.
--
-- So this function reads the stage as a CLAIM and asks the record whether it
-- happened. Mobilised needs people, a signed contract, money moved, or work
-- finished. Seeking bids needs a package to have gone out. When the evidence
-- is not there the claim is dropped to what is actually true, which is
-- usually "nothing has happened yet" - and a list of things to do is still
-- not a job under way.
--
-- It lives in the database rather than in one screen so the homeowner door
-- and the Professionals door can never tell the same person two different
-- stories about the same job.
create or replace function public.project_progress(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  p public.projects; ord int; bstate text;
  v_pkgs int; v_bids int; v_crew int; v_done int; v_open int; v_contracts int; v_paid numeric;
begin
  select * into p from public.projects where id = p_project;
  if p.id is null then return null; end if;

  -- An ending is an ending; no evidence below outranks it.
  if p.status = 'Closed - Completed' then
    return jsonb_build_object('key','done','label','Done','detail','finished and signed off','order',9);
  end if;
  if p.status like 'Closed%' then
    return jsonb_build_object('key','cancelled','label','Cancelled','detail','it will not happen','order',9);
  end if;

  select b.state into bstate from public.project_bookings b where b.project_id = p_project;
  select count(*) into v_pkgs from public.bid_packages where project_id = p_project;
  select count(*) into v_bids from public.bids where project_id = p_project;
  select count(*) into v_crew from public.project_members
   where project_id = p_project and status = 'active'
     and coalesce(project_role,'') not in ('asset owner','viewer');
  select count(*) filter (where status = 'Completed'),
         count(*) filter (where status not in ('Completed','Cancelled','Force Cancelled','Superseded'))
    into v_done, v_open
    from public.actions where project_id = p_project;
  select count(*) into v_contracts from public.contracts
   where project_id = p_project and coalesce(status,'') <> 'placeholder';
  select coalesce(sum(amount), 0) into v_paid from public.transactions
   where project_id = p_project
     and coalesce(status,'') in ('paid','paid - receipt filed','paid - pending confirmation','settled');

  ord := coalesce((select stage_order from public.engagement_stages where stage = p.stage), 0);

  -- A booking still says it better than a stage does while it is a plan or
  -- while it is out with the community.
  if bstate = 'planned' then
    return jsonb_build_object('key','planned','label','Planned','detail','a price, nobody hired yet','order',0);
  end if;
  if bstate = 'posted' then
    return jsonb_build_object('key','finding','label','Finding someone','detail','out to the community','order',1);
  end if;

  -- SOMEBODY IS ACTUALLY DOING IT - claimed from 'active' (order 6) up, and
  -- checked here. Mobilised means people on it, terms signed, money moved or
  -- work finished. Any one of those will do; none of them means no.
  if ord >= 6 and (v_crew > 0 or v_contracts > 0 or v_paid > 0 or v_done > 0) then
    if p.stage = 'delivered' then
      return jsonb_build_object('key','delivered','label','They say it''s finished',
        'detail','nobody has walked it and the town has not seen it','order',7);
    elsif p.stage = 'verification' then
      return jsonb_build_object('key','verification','label','Waiting on sign-off',
        'detail','yours, the town''s, or both','order',8);
    end if;
    return jsonb_build_object('key','active','label','Work under way',
      'detail', coalesce(nullif(concat_ws(' · ',
        case when v_crew > 0 then v_crew || (case when v_crew = 1 then ' person' else ' people' end) || ' on it' end,
        case when v_done > 0 then v_done || ' done' end), ''), 'on site'),
      'order', 6);
  end if;

  -- GETTING PRICES, by the same test: the bid stage means nothing until a
  -- package actually went out.
  if v_bids > 0 then
    return jsonb_build_object('key','compare','label','Comparing prices',
      'detail', v_bids || (case when v_bids = 1 then ' price in' else ' prices in' end), 'order', 2);
  end if;
  if v_pkgs > 0 then
    return jsonb_build_object('key','bid','label','Getting prices',
      'detail','the scope is out, no prices back yet','order',1);
  end if;

  -- Nothing has happened to it. Things written down are not work started.
  if v_open > 0 then
    return jsonb_build_object('key','listed','label','On your list',
      'detail', v_open || (case when v_open = 1 then ' thing' else ' things' end) || ' to do, nobody on it yet',
      'order', 0);
  end if;
  return jsonb_build_object('key','not_started','label','Not started','detail','nothing on it yet','order',0);
end $fn$;

comment on function public.project_progress(uuid) is
  'Where a job honestly stands, as {key,label,detail,order}. projects.stage is the intention; this checks it against people, contracts, money, bids and finished work, and drops the claim when the record does not support it. projects.status is NOT a progress signal - it is In Progress on everything that is not closed.';

grant execute on function public.project_progress(uuid) to authenticated;

-- Both halves of the homeowner list carry it, so a booked job and an
-- unbooked one are described by the same rule.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.homeowner_me()'::regprocedure);
  out_ := replace(src,
    $a$        'cover_url', public.project_face_url(j.id),$a$,
    $b$        'cover_url', public.project_face_url(j.id),
        'progress_label', public.project_progress(j.id),$b$);
  out_ := replace(out_,
    $a$        'progress', public.homeowner_progress(b.project_id),$a$,
    $b$        'progress', public.homeowner_progress(b.project_id),
        'progress_label', public.project_progress(b.project_id),$b$);
  if out_ = src then raise exception 'homeowner_me has drifted - neither anchor matched'; end if;
  if (length(out_) - length(replace(out_, 'progress_label', ''))) / length('progress_label') <> 2 then
    raise exception 'homeowner_me has drifted - expected both anchors';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
