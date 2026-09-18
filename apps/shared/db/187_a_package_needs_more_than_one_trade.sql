-- 187: A PACKAGE NEEDS MORE THAN ONE TRADE, AND A STEP KNOWS WHOSE IT IS.
--
-- Shahar (2026-09-18), looking at the generator: "i would like to be able to
-- store more than one trade on a project. in this case, we need plumber,
-- electrician, and optional project manager / GC. users can access step by
-- step DIY process as well."
--
-- The generator carried ONE trade - Electrical - so everything it created
-- pointed at an electrician, while the gas line, the meter and the mechanical
-- permit are the plumber's. The knowledge was already written into the steps
-- ("Plumber" on step 40) and was unusable: default_assigned_to is free text
-- and across every blueprint held Bob, Contracto, Einstein, Electrician,
-- Owner, Plumber, PM / Owner, Shahar, Town and Zoe - not one of which matches
-- a row in trades ("Plumber" is not "Plumbing").
--
-- TRADES ARE EQUALS, NOT A CHAIN (his choice): each is hired and paid on its
-- own and we run the sequence between them. So this is a LIST, and the only
-- thing that separates one from another is whether the job needs it at all -
-- a generator always needs a plumber and an electrician, and sometimes wants
-- somebody running it.
--
-- Applied as 187a..187e.

-- ---------------------------------------------------------------------------
-- 187a  The trades a package needs
-- ---------------------------------------------------------------------------
create table if not exists public.blueprint_package_trades (
  id           uuid primary key default gen_random_uuid(),
  package_code text not null references public.blueprint_packages(code) on delete cascade,
  trade        text not null references public.trades(trade),
  need         text not null default 'required',
  note         text,
  sort_order   integer not null default 0,
  created_at   timestamptz default now(),
  created_by   text default 'portal',
  constraint chk_package_trade_need check (need in ('required','optional')),
  constraint uq_package_trade unique (package_code, trade)
);
create index if not exists ix_package_trades on public.blueprint_package_trades (package_code, sort_order);

comment on table public.blueprint_package_trades is
  'Every trade a package needs, as equals - each hired and paid on its own while we run the sequence. need=optional is a trade the job sometimes wants (a project manager) rather than always needs. blueprint_packages.trade stays as the tile''s headline trade only.';

alter table public.blueprint_package_trades enable row level security;
drop policy if exists "package trades are the platform's" on public.blueprint_package_trades;
create policy "package trades are the platform's" on public.blueprint_package_trades
  for select to authenticated using (true);
drop policy if exists "package trades written by superadmin" on public.blueprint_package_trades;
create policy "package trades written by superadmin" on public.blueprint_package_trades
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- BACKFILL: the single trade each package already carries becomes its first
-- required one, so nothing loses what it had.
insert into public.blueprint_package_trades (package_code, trade, need, sort_order, created_by)
select p.code, p.trade, 'required', 10, 'migration:187'
  from public.blueprint_packages p
  join public.trades t on t.trade = p.trade
 where p.trade is not null
on conflict (package_code, trade) do nothing;

-- AND THE GENERATOR, said out loud: the plumber it always needed, and the
-- hand on the tiller it sometimes wants.
insert into public.blueprint_package_trades (package_code, trade, need, note, sort_order, created_by)
values ('generator', 'Plumbing', 'required',
        'Gas line, the meter, the gas diagram and the mechanical permit.', 20, 'migration:187'),
       ('generator', 'Project manager', 'optional',
        'Or a GC - when the owner wants somebody running it rather than running it themselves.', 30, 'migration:187')
on conflict (package_code, trade) do nothing;

update public.blueprint_package_trades
   set note = 'The jacket, the electrical permit, the transfer switch and the connection.'
 where package_code = 'generator' and trade = 'Electrical' and note is null;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 187b  A step names a trade, or it is ours
-- ---------------------------------------------------------------------------
-- default_assigned_to stays for now as the words somebody typed, but it stops
-- being the thing anything reads. trade is null on a step WE do - calling the
-- utility, ordering the kit, booking the inspection - and only steps with a
-- trade can become a bid room or a contractor's task.
alter table public.blueprint_activity_steps
  add column if not exists trade text references public.trades(trade),
  add column if not exists hidden_from_owner boolean not null default false;

comment on column public.blueprint_activity_steps.trade is
  'Whose step it is. NULL means ours - the utility call, the order, the inspection booking - and only a step with a trade can become a bid room or a contractor''s task.';
comment on column public.blueprint_activity_steps.hidden_from_owner is
  'A step the homeowner should not be shown in the DIY walkthrough. Default false: they see the process.';

-- THE MAPPING, once. "Plumber" is not "Plumbing" and "Electrician" is not
-- "Electrical", which is exactly why none of this worked.
update public.blueprint_activity_steps set trade = 'Plumbing'
 where trade is null and default_assigned_to in ('Plumber', 'Plumbing');
update public.blueprint_activity_steps set trade = 'Electrical'
 where trade is null and default_assigned_to in ('Electrician', 'Electrical');
update public.blueprint_activity_steps set trade = 'HVAC'
 where trade is null and default_assigned_to in ('HVAC', 'HVAC tech');
update public.blueprint_activity_steps set trade = 'General Contractor'
 where trade is null and default_assigned_to in ('Contractor', 'Contracto', 'GC');
-- Everything else - PM / Owner, Owner, Shahar, Bob, Zoe, Einstein, Town - is
-- ours or a person, and a person is not a trade. Left null on purpose.

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 187c  The package editor reads and writes the trades
-- ---------------------------------------------------------------------------
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_package';

  out_ := replace(src,
    $old$'contractors',$old$,
    $new$'trades', coalesce((select jsonb_agg(jsonb_build_object(
          'id', pt.id, 'trade', pt.trade, 'need', pt.need, 'note', pt.note, 'sort_order', pt.sort_order)
          order by pt.sort_order, pt.trade)
        from blueprint_package_trades pt where pt.package_code = p.code), '[]'::jsonb),
    'trade_choices', coalesce((select jsonb_agg(t.trade order by t.sort_order nulls last, t.trade)
        from trades t where t.trade <> 'ALL'), '[]'::jsonb),
    'contractors',$new$);

  if out_ = src then raise exception 'admin_package: the contractors line moved'; end if;
  execute out_;
end $patch$;

create or replace function public.admin_package_trade_save(
  p_code text, p_trade text, p_need text default 'required', p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sort integer;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'The catalogue is not yours to change.');
  end if;
  if not exists (select 1 from public.blueprint_packages where code = p_code) then
    return jsonb_build_object('ok', false, 'reason', 'No such package.');
  end if;
  if not exists (select 1 from public.trades where trade = p_trade) then
    return jsonb_build_object('ok', false, 'reason', format('"%s" is not a trade we know.', p_trade));
  end if;
  if coalesce(p_need, 'required') not in ('required','optional') then
    return jsonb_build_object('ok', false, 'reason', 'A trade is required or optional.');
  end if;

  select coalesce(max(sort_order), 0) + 10 into v_sort
    from public.blueprint_package_trades where package_code = p_code;

  insert into public.blueprint_package_trades (package_code, trade, need, note, sort_order, created_by)
  values (p_code, p_trade, coalesce(p_need, 'required'), nullif(btrim(p_note), ''), v_sort, 'admin')
  on conflict (package_code, trade) do update
    set need = excluded.need, note = coalesce(excluded.note, blueprint_package_trades.note);

  return jsonb_build_object('ok', true, 'trade', p_trade,
    'trades', (select count(*) from public.blueprint_package_trades where package_code = p_code));
end $$;
revoke all on function public.admin_package_trade_save(text, text, text, text) from public, anon;
grant execute on function public.admin_package_trade_save(text, text, text, text) to authenticated;

create or replace function public.admin_package_trade_remove(p_code text, p_trade text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'The catalogue is not yours to change.');
  end if;
  delete from public.blueprint_package_trades where package_code = p_code and trade = p_trade;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_package_trade_remove(text, text) from public, anon;
grant execute on function public.admin_package_trade_remove(text, text) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 187d  The process editor speaks trades, and the owner can read the process
-- ---------------------------------------------------------------------------
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_process';
  out_ := replace(src,
    $old$'default_assigned_to', s.default_assigned_to, 'necessity', s.necessity,$old$,
    $new$'default_assigned_to', s.default_assigned_to, 'necessity', s.necessity,
          'trade', s.trade, 'hidden_from_owner', coalesce(s.hidden_from_owner, false),$new$);
  if out_ = src then raise exception 'portal_process: the assignee line moved'; end if;
  execute out_;
end $patch$;

create or replace function public.portal_process_step_save(
  p_step uuid, p_blueprint uuid, p_name text, p_notes text default null,
  p_photo_url text default null, p_after uuid default null, p_assignee text default null,
  p_action_type text default null, p_is_gate boolean default null, p_necessity text default null,
  p_asks text default null, p_decides text default null, p_answers text[] default null,
  p_only_if jsonb default null, p_trade text default null, p_hidden_from_owner boolean default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_order integer; v_trade text;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'A process is the platform''s, not one job''s.');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'A step needs a name.');
  end if;

  -- A TRADE, OR OURS. The empty string and "us" both mean ours, which is what
  -- a picker sends when nobody is hired for a step.
  v_trade := nullif(nullif(btrim(coalesce(p_trade, '')), ''), 'us');
  if v_trade is not null and not exists (select 1 from public.trades t where t.trade = v_trade) then
    return jsonb_build_object('ok', false, 'reason', format('"%s" is not a trade we know.', v_trade));
  end if;

  if p_step is null then
    if p_notes is null or btrim(p_notes) = '' then
      return jsonb_build_object('ok', false, 'code', 'NO_WHY',
        'reason', 'Say what this step is for. A step with no explanation is one nobody can follow.');
    end if;
    select coalesce(max(step_order), 0) + 10 into v_order
      from public.blueprint_activity_steps where activity_blueprint_id = p_blueprint;
    insert into public.blueprint_activity_steps
      (activity_blueprint_id, step_order, step_name, notes, photo_url, default_assigned_to,
       action_type, is_gate, necessity, asks, decides, answers, only_if, trade, hidden_from_owner)
    values (p_blueprint, v_order, btrim(p_name), nullif(btrim(p_notes), ''), nullif(btrim(p_photo_url), ''),
            coalesce(nullif(btrim(p_assignee), ''), v_trade, 'us'),
            p_action_type, coalesce(p_is_gate, false), p_necessity, nullif(btrim(p_asks), ''),
            nullif(btrim(p_decides), ''), p_answers, p_only_if, v_trade, coalesce(p_hidden_from_owner, false))
    returning id into v_id;
  else
    update public.blueprint_activity_steps set
      step_name = btrim(p_name),
      notes = coalesce(nullif(btrim(p_notes), ''), notes),
      photo_url = coalesce(nullif(btrim(p_photo_url), ''), photo_url),
      default_assigned_to = coalesce(nullif(btrim(p_assignee), ''), v_trade, default_assigned_to),
      action_type = coalesce(p_action_type, action_type),
      is_gate = coalesce(p_is_gate, is_gate),
      necessity = coalesce(p_necessity, necessity),
      asks = coalesce(nullif(btrim(p_asks), ''), asks),
      decides = coalesce(nullif(btrim(p_decides), ''), decides),
      answers = coalesce(p_answers, answers),
      only_if = coalesce(p_only_if, only_if),
      trade = case when p_trade is null then trade else v_trade end,
      hidden_from_owner = coalesce(p_hidden_from_owner, hidden_from_owner)
    where id = p_step
    returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'trade', v_trade);
end $$;
revoke all on function public.portal_process_step_save(uuid, uuid, text, text, text, uuid, text, text, boolean, text, text, text, text[], jsonb, text, boolean) from public, anon;
grant execute on function public.portal_process_step_save(uuid, uuid, text, text, text, uuid, text, text, boolean, text, text, text, text[], jsonb, text, boolean) to authenticated;
drop function if exists public.portal_process_step_save(uuid, uuid, text, text, text, uuid, text, text, boolean, text, text, text, text[], jsonb);

create or replace function public.homeowner_package_process(p_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when bp.activity_blueprint_id is null then null else jsonb_build_object(
    'package', bp.code, 'name', bp.name,
    'process', (select a.name from blueprint_activity a where a.id = bp.activity_blueprint_id),
    'trades', coalesce((select jsonb_agg(jsonb_build_object('trade', pt.trade, 'need', pt.need, 'note', pt.note)
                 order by pt.sort_order, pt.trade)
               from blueprint_package_trades pt where pt.package_code = bp.code), '[]'::jsonb),
    'steps', coalesce((select jsonb_agg(jsonb_build_object(
          'n', s.step_order, 'step', s.step_name, 'why', s.notes, 'photo', s.photo_url,
          'trade', s.trade, 'is_gate', coalesce(s.is_gate, false),
          'asks', s.asks, 'decides', s.decides, 'answers', to_jsonb(s.answers), 'only_if', s.only_if)
        order by s.step_order)
      from blueprint_activity_steps s
     where s.activity_blueprint_id = bp.activity_blueprint_id
       and not coalesce(s.hidden_from_owner, false)), '[]'::jsonb))
  end
  from blueprint_packages bp where bp.code = p_code and bp.is_active;
$$;
revoke all on function public.homeowner_package_process(text) from public;
grant execute on function public.homeowner_package_process(text) to anon, authenticated;

comment on function public.homeowner_package_process(text) is
  'The step-by-step a homeowner reads before deciding to do it themselves or hire it out. Steps marked hidden_from_owner never appear; the trade on each step says which parts need a licensed hand.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 187e  A domain is a name
-- ---------------------------------------------------------------------------
-- portal_process_save guarded its domain against public.domains.domain - a
-- column that does not exist; the table keys on name. Every call raised 42703
-- before it wrote anything, which is why no process has ever been made or
-- renamed from a screen. Found the moment the Activities screen called it.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_process_save(uuid,text,text,text,boolean)'::regprocedure);
  out_ := replace(src,
    'from public.domains d where d.domain = coalesce(p_domain, ''construction'')',
    'from public.domains d where d.name = coalesce(p_domain, ''construction'')');
  if out_ = src then
    raise exception 'portal_process_save has drifted - the domain check was not found.';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
