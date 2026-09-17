-- 179: TWO ROWS FOR ONE COMPANY BECOME ONE.
--
-- Shahar (2026-09-17), on HVAC: "Merge into FUSION HEATING AND COOLING."
-- "Fusion" and "FUSION HEATING AND COOLING" were the same firm twice, one
-- from the migration that split company names off contacts and one typed
-- since. contract_merge already exists for the same problem on contracts;
-- this is its equal for companies, and it moves EVERY reference by reading
-- the foreign keys from the catalogue rather than a list somebody has to
-- keep in step - eighteen columns today, and whatever is added later.
create or replace function public.company_merge(p_from uuid, p_into uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_from text; v_into text; r record; v_n integer; v_moved jsonb := '{}'::jsonb;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED',
      'reason', 'Merging two companies rewrites every contract and bid that named them. That is not yours to do.');
  end if;
  if p_from = p_into then
    return jsonb_build_object('ok', false, 'reason', 'Those are the same company.');
  end if;
  select company_name into v_from from public.companies where id = p_from;
  select company_name into v_into from public.companies where id = p_into;
  if v_from is null or v_into is null then
    return jsonb_build_object('ok', false, 'reason', 'One of those companies is not on file.');
  end if;

  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.confrelid = 'public.companies'::regclass and c.contype = 'f'
     order by 1, 2
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_into, p_from;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        v_moved := v_moved || jsonb_build_object(r.tbl || '.' || r.col, v_n);
      end if;
    exception when unique_violation then
      -- Both rows already said the same thing (a trade role, a party class).
      -- The duplicate is dropped rather than moved.
      execute format('delete from %s where %I = $1', r.tbl, r.col) using p_from;
    end;
  end loop;

  update public.companies
     set notes = coalesce(notes || E'\n\n', '') || 'MERGED IN: "' || v_from || '" on '
                 || to_char(current_date, 'Mon DD, YYYY')
                 || coalesce(' - ' || nullif(btrim(p_reason), ''), '') || '.',
         main_phone = coalesce(main_phone, (select main_phone from public.companies where id = p_from)),
         main_email = coalesce(main_email, (select main_email from public.companies where id = p_from)),
         address    = coalesce(address,    (select address    from public.companies where id = p_from)),
         last_modified_at = now(), last_modified_by = 'portal:company-merge'
   where id = p_into;

  delete from public.companies where id = p_from;

  return jsonb_build_object('ok', true, 'from', v_from, 'into', v_into, 'moved', v_moved);
end $$;
revoke all on function public.company_merge(uuid, uuid, text) from public, anon;
grant execute on function public.company_merge(uuid, uuid, text) to authenticated;
comment on function public.company_merge(uuid, uuid, text) is
  'Moves every reference from one company row onto another and removes the first. Reads the foreign keys from the catalogue, so a table added later is carried automatically. Migration 179.';

-- ---------------------------------------------------------------------------
-- 179b, applied as its own step. ONE WORKING LINE PER TRADE AND CONTRACTOR
-- (uq_engagements_project_trade_contractor). 177c wrote the line by
-- insert-then-update, which on a trade that already had an EMPTY line - the
-- log import wrote one for HVAC with nobody on it - tried to put the same
-- contractor on two rows at once and the award failed on the constraint.
-- Three cases, mutually exclusive: fill the row that already names them,
-- else adopt the empty one, else write a new one. The patched block is in
-- the migration named 179b_one_working_line_per_trade_and_contractor.

-- ---------------------------------------------------------------------------
-- Applied live on 55 Walnut's New build, on Shahar's word (2026-09-17):
--   * "Fusion" merged into "FUSION HEATING AND COOLING"; Luis Bermudez and
--     his employment, trade role and company role moved across.
--   * Jacob and Estuardo closed as lost in the HVAC room.
--   * Luis's bid negotiated from $38,740 to $29,790 and awarded, which wrote
--     the contract and seated FUSION HEATING AND COOLING on the job.
--   * The contract signed 2026-09-11 at $29,790. The manuals portion, $790,
--     is already done, so the balance is $29,000 - recorded on the contract,
--     not yet logged as a payment because that needs the account it left.
