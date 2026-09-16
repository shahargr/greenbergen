-- 160. ONE TRADE, ONE CONTRACT - UNLESS YOU SAY OTHERWISE.
--
-- Shahar (2026-09-16), seeing two Kuiken Brothers contracts under Supply:
-- Lumber - "George Orellana - Kuiken Brothers - Supply: Lumber (placeholder)"
-- beside "Lumber Supply Arrangement (awarded bid, target price)": "how was
-- this ever possible... merge the two / this was a mistake when creating
-- the task most likely. moving forward, if someone is trying to open a new
-- contract for a trade with a contract on a project, raise a flag. allow
-- it, but in most cases i think it is a mistake."
--
-- HOW IT WAS POSSIBLE: the seat backfill of 2026-09-01 wrote a placeholder
-- per seat, and the trigger that should have found the real contract
-- compared a person seat with counterparty_contact_id while the real
-- contract named the company (154 fixed the match). Eleven twins came out
-- of that one morning; this was one. Since 154 a same-party twin cannot be
-- opened - the seat binds to the live contract - but a contract for the
-- same TRADE with a DIFFERENT party still could, silently. Now it flags.
--
-- 1. contract_merge(from, into): everything hanging off the first contract
--    - seats, tasks, payments, files, stages, scope lines, bids, packages,
--    phases - moves to the second, and the first is deleted, or marked
--    Cancelled with a note when something still holds it. Only a
--    placeholder, or a contract with the same party, may be merged away.
--    The Kuiken pair is merged here; ten more twins wait on a word.
--
-- 2. portal_award_trade and portal_award_add_trade take p_confirm. Opening
--    a NEW contract for a trade that already has one on the job, with
--    somebody else, is refused with code HAS_CONTRACT and the list, until
--    the screen sends p_confirm - one tick, "open a new one anyway". Old
--    signatures dropped (BUILD.md §16).

-- ---------------------------------------------------------------------------
-- 1. Merge.
-- ---------------------------------------------------------------------------
create or replace function public.contract_merge(p_from uuid, p_into uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare a public.contracts; b public.contracts; v_same boolean; v_gone boolean := false; n int; moved jsonb := '{}'::jsonb;
begin
  select * into a from public.contracts where id = p_from;
  select * into b from public.contracts where id = p_into;
  if a.id is null or b.id is null then return jsonb_build_object('ok', false, 'reason', 'One of those contracts is not on file.'); end if;
  if a.id = b.id then return jsonb_build_object('ok', false, 'reason', 'That is the same contract twice.'); end if;
  if a.project_id is distinct from b.project_id then
    return jsonb_build_object('ok', false, 'reason', 'Those contracts are on different jobs.');
  end if;
  v_same := (a.counterparty_company_id is not null and a.counterparty_company_id = b.counterparty_company_id)
         or (a.counterparty_contact_id is not null and a.counterparty_contact_id in (b.counterparty_contact_id, b.contractor_id))
         or (a.contractor_id is not null and a.contractor_id in (b.counterparty_contact_id, b.contractor_id))
         or (a.counterparty_contact_id is not null and b.counterparty_company_id is not null
             and b.counterparty_company_id = (select company_id from public.contacts where id = a.counterparty_contact_id));
  if a.status <> 'placeholder' and not v_same then
    return jsonb_build_object('ok', false, 'reason',
      format('"%s" is a real contract with a different party - merging it into "%s" would rewrite who was paid.', a.title, b.title));
  end if;

  update public.project_members set contract_id = p_into where contract_id = p_from; get diagnostics n = row_count; moved := moved || jsonb_build_object('seats', n);
  update public.actions set contract_id = p_into where contract_id = p_from; get diagnostics n = row_count; moved := moved || jsonb_build_object('tasks', n);
  update public.transactions set contract_id = p_into where contract_id = p_from; get diagnostics n = row_count; moved := moved || jsonb_build_object('payments', n);
  update public.file_links set contract_id = p_into where contract_id = p_from; get diagnostics n = row_count; moved := moved || jsonb_build_object('files', n);
  update public.payment_stages set contract_id = p_into where contract_id = p_from; get diagnostics n = row_count; moved := moved || jsonb_build_object('stages', n);
  update public.project_scope_items set contract_id = p_into where contract_id = p_from; get diagnostics n = row_count; moved := moved || jsonb_build_object('scope_lines', n);
  update public.bids set contract_id = p_into where contract_id = p_from;
  update public.bid_packages set contract_id = p_into where contract_id = p_from;
  update public.contract_phases set contract_id = p_into where contract_id = p_from;
  update public.contracts set parent_contract_id = p_into where parent_contract_id = p_from;
  update public.app_invitations set contract_id = p_into where contract_id = p_from;

  -- The trade travels when the survivor has none.
  update public.contracts set trade = coalesce(trade, a.trade) where id = p_into;

  -- Delete only when nothing else still holds it - a cascade would take
  -- rows this did not move (insurance, warranties, allocations, disputes,
  -- bookings) down with it, silently.
  if not exists (select 1 from public.contract_insurance where contract_id = p_from)
     and not exists (select 1 from public.contract_warranties where contract_id = p_from)
     and not exists (select 1 from public.contract_budget_allocations where contract_id = p_from)
     and not exists (select 1 from public.contract_disputes where contract_id = p_from or resulting_change_order_id = p_from)
     and not exists (select 1 from public.project_participants where contract_id = p_from)
     and not exists (select 1 from public.project_bookings where contract_id = p_from)
     and not exists (select 1 from public.surveys where subject_contract_id = p_from)
     and not exists (select 1 from public.promotions where agreement_contract_id = p_from)
     and not exists (select 1 from public.promotion_clusters where contract_id = p_from)
     and not exists (select 1 from public.project_scope_items where change_order_id = p_from) then
    begin
      delete from public.contracts where id = p_from;
      v_gone := true;
    exception when foreign_key_violation then
      v_gone := false;
    end;
  end if;
  if not v_gone then
    update public.contracts
       set status = 'Cancelled',
           notes = coalesce(notes || E'\n\n', '') || '[' || to_char(current_date, 'YYYY-MM-DD') || '] Merged into "' || b.title
                || '" (' || p_into::text || '). Everything that hung off this contract moved there; this row stays only because something still references it.',
           last_modified_by = 'contract_merge'
     where id = p_from;
  end if;

  return jsonb_build_object('ok', true, 'into', p_into, 'from', p_from, 'deleted', v_gone, 'moved', moved);
end $$;

comment on function public.contract_merge(uuid, uuid) is
  'Move everything off one contract onto another and remove the first (Cancelled if something still holds it). Only a placeholder, or a contract with the same party, may be merged away.';

select public.contract_merge('0f00c396-58c0-43f7-9306-3b62edc82b4f', '8c8fa88c-bc0f-4644-8b81-4658bb711375');

-- ---------------------------------------------------------------------------
-- 2. The flag.
-- ---------------------------------------------------------------------------
do $patch$
declare src text; out_ text; step text;
begin
  select pg_get_functiondef('public.portal_award_trade(uuid, uuid, text, text, uuid)'::regprocedure) into src;
  out_ := src;

  step := 'signature';
  out_ := replace(out_, 'p_contract uuid DEFAULT NULL::uuid)', 'p_contract uuid DEFAULT NULL::uuid, p_confirm boolean DEFAULT false)');
  if out_ = src then raise exception 'portal_award_trade has drifted at %', step; end if;
  src := out_;

  step := 'declare';
  out_ := replace(out_,
    $a$  v_old uuid; v_old_notes text; v_old_joined date;   -- a seat taken off earlier$a$,
    $b$  v_old uuid; v_old_notes text; v_old_joined date;   -- a seat taken off earlier
  v_existing jsonb;                                    -- contracts this trade already has, with others (160)$b$);
  if out_ = src then raise exception 'portal_award_trade has drifted at %', step; end if;
  src := out_;

  step := 'flag';
  out_ := replace(out_,
    $a$  -- OUR OWN SIDE OF THE BOOK. Exactly the test fn_members_ensure_contract$a$,
    $b$  -- A CONTRACT FOR THIS TRADE ALREADY EXISTS, WITH SOMEBODY ELSE (160).
  -- Shahar: "if someone is trying to open a new contract for a trade with a
  -- contract on a project, raise a flag. allow it, but in most cases i
  -- think it is a mistake." A contract with THIS person is not flagged -
  -- the seat binds to it rather than opening a twin (154). One with another
  -- party is refused once, with the list, until the screen says p_confirm.
  if p_contract is null and v_trade is not null and not coalesce(p_confirm, false) then
    select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status, 'who', x.who) order by x.title)
      into v_existing
      from (
        select c2.id, c2.title, c2.status,
               coalesce((select co.company_name from public.companies co where co.id = c2.counterparty_company_id),
                        (select coalesce(ct.person_name, ct.name) from public.contacts ct
                          where ct.id = coalesce(c2.contractor_id, c2.counterparty_contact_id))) as who
          from public.contracts c2
         where c2.project_id = p_project
           and c2.direction = 'payable'
           and coalesce(c2.status, '') <> 'Cancelled'
           and coalesce((select t.trade from public.trades t where lower(t.trade) = lower(btrim(c2.trade)) limit 1), c2.trade) = v_trade
           and not coalesce(c2.contractor_id = v_contact, false)
           and not coalesce(c2.counterparty_contact_id = v_contact, false)
           and not coalesce(c2.counterparty_company_id = v_company, false)
      ) x;
    if v_existing is not null then
      return jsonb_build_object('ok', false, 'code', 'HAS_CONTRACT', 'trade', v_trade, 'contracts', v_existing,
        'reason', format('%s already has %s on this job: %s. If %s is joining that work, pick the contract above; if this really is a second, separate contract, tick "open a new one anyway".',
                         v_trade,
                         case when jsonb_array_length(v_existing) = 1 then 'a contract' else jsonb_array_length(v_existing) || ' contracts' end,
                         (select string_agg('"' || e->>'title' || '"' || coalesce(' with ' || (e->>'who'), ''), '; ') from jsonb_array_elements(v_existing) e),
                         v_name));
    end if;
  end if;

  -- OUR OWN SIDE OF THE BOOK. Exactly the test fn_members_ensure_contract$b$);
  if out_ = src then raise exception 'portal_award_trade has drifted at %', step; end if;

  execute out_;
end $patch$;

drop function if exists public.portal_award_trade(uuid, uuid, text, text, uuid);

do $patch$
declare src text; out_ text; step text;
begin
  select pg_get_functiondef('public.portal_award_add_trade(uuid, text, text, text, text, text, text)'::regprocedure) into src;
  out_ := src;
  step := 'signature';
  out_ := replace(out_, 'p_note text DEFAULT NULL::text)', 'p_note text DEFAULT NULL::text, p_confirm boolean DEFAULT false)');
  if out_ = src then raise exception 'portal_award_add_trade has drifted at %', step; end if;
  src := out_;
  step := 'call';
  out_ := replace(out_,
    'r := public.portal_award_trade(p_project, v_contact, p_trade, p_note);',
    'r := public.portal_award_trade(p_project, v_contact, p_trade, p_note, null, p_confirm);');
  if out_ = src then raise exception 'portal_award_add_trade has drifted at %', step; end if;
  execute out_;
end $patch$;

drop function if exists public.portal_award_add_trade(uuid, text, text, text, text, text, text);

-- The overload sweep (BUILD.md §16).
do $sweep$
declare r record;
begin
  for r in
    select p.proname, count(*) as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('portal_award_trade', 'portal_award_add_trade', 'contract_merge')
     group by p.proname having count(*) > 1
  loop
    raise exception 'OVERLOAD: % has % signatures', r.proname, r.n;
  end loop;
end $sweep$;

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
