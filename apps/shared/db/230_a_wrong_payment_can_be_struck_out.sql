-- A WRONG PAYMENT CAN BE STRUCK OUT.
--
-- Shahar, 2026-09-24, redesigning the transaction ledger: every row gets
-- "Edit and Delete". Editing existed (portal_transaction_edit, 073); a
-- delete verb did not - a payment logged twice or against the wrong
-- project simply sat there forever.
--
-- Hard delete, guarded like the rest of the money screens
-- (bid_can_manage), and NEVER silent: a change_events row records what was
-- struck out - amount, status, description - before the row goes. The FKs
-- already behave: receipts unfile (file_links cascade; the FILES survive,
-- as everywhere), transaction_targets cascade, stage_settlements set null
-- so a paid stage returns to open rather than pointing at nothing.
create or replace function public.portal_transaction_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare t public.transactions;
begin
  select * into t from public.transactions where id = p_id;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'That payment does not exist.'); end if;
  if not public.bid_can_manage(t.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'This project''s money is not yours to touch.');
  end if;

  insert into public.change_events (id, table_name, row_id, field, from_value, to_value, op, actor)
  values (gen_random_uuid(), 'transactions', t.id::text, 'deleted',
          concat_ws(' · ', t.paid_on, t.status, t.amount::text, left(coalesce(t.description, ''), 120)),
          null, 'delete', 'portal:ledger');

  delete from public.transactions where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

comment on function public.portal_transaction_delete(uuid) is
  'Strikes a payment out of the ledger (230), guarded by bid_can_manage and '
  'recorded in change_events first. Receipts unfile but the files survive; '
  'a settled stage reopens.';
