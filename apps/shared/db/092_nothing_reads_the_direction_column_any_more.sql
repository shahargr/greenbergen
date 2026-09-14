-- 092 - Nothing reads the direction column any more.
--
-- Shahar (2026-09-14): "i'm not ok with functions reading the direction
-- column. check if these are necessary, or can be fixed in a way they don't
-- read this."
--
-- They are not necessary. Every read is the same question - did this money
-- leave one of our accounts? - and since migration 090 that question is
-- answered by source_account_id, on all 173 rows, with zero disagreement
-- between the two. direction is the same fact spelled a second time, and a
-- fact spelled twice is a fact that can contradict itself.
--
-- A note on the count: a text search for "direction" hits 37 functions, which
-- badly overstates it. This database has four direction columns -
-- messages.direction (inbound/outbound), contracts.direction
-- (payable/receivable), stage_settlements.direction, and this one. Only 19
-- functions touch transactions.direction. This migration does the 14 that
-- READ it; 093 does the ones that write it and then drops the column.
--
-- The patches are applied in place, by pulling each function's own source and
-- swapping the predicate, so that a 120-line function does not have to be
-- restated here to change one line of it. Every pattern is counted before it
-- is replaced: if a function has been edited since and the text no longer
-- matches exactly, the whole migration fails rather than half-patching the
-- database.

do $patch$
declare
  j     record;
  src   text;
  patched text;
  found int;
begin
  for j in
    select * from (values
      -- "is this money going out?" -> "did it leave one of our accounts?"
      ('app_contractor_rollup', $f$coalesce(t.direction,'out')='out'$f$,
                                $f$t.source_account_id is not null$f$, 2),
      ('portal_bidder_history', $f$t.direction = 'out'$f$,
                                $f$t.source_account_id is not null$f$, 1),
      ('portal_contractor',     $f$t.direction = 'out'$f$,
                                $f$t.source_account_id is not null$f$, 1),
      ('portal_finance_rollup', $f$where direction = 'out'$f$,
                                $f$where source_account_id is not null$f$, 1),
      ('portal_finance_rollup', $f$tr.direction = 'out'$f$,
                                $f$tr.source_account_id is not null$f$, 1),
      ('portal_my_work',        $f$t.direction = 'out'$f$,
                                $f$t.source_account_id is not null$f$, 1),
      ('portal_project_cancel', $f$t2.direction = 'out'$f$,
                                $f$t2.source_account_id is not null$f$, 1),
      ('portal_project_cards',  $f$tt.direction = 'out'$f$,
                                $f$tt.source_account_id is not null$f$, 1),
      ('portal_project_close',  $f$t.direction = 'out'$f$,
                                $f$t.source_account_id is not null$f$, 1),
      ('portal_site_week',      $f$tx.direction = 'out'$f$,
                                $f$tx.source_account_id is not null$f$, 1),
      ('project_financials',    $f$t.direction = 'out'$f$,
                                $f$t.source_account_id is not null$f$, 2),
      ('project_financials',    $f$z.direction = 'out'$f$,
                                $f$z.source_account_id is not null$f$, 1),

      -- The status vocabulary is still keyed to direction - "paid" is an
      -- outgoing status, "payment received" an incoming one, "settled" either.
      -- That stays; it just derives the direction instead of reading it.
      ('project_financials',    $f$ts.direction in (t.direction, 'both')$f$,
                                $f$ts.direction in (case when t.source_account_id is not null then 'out' else 'in' end, 'both')$f$, 3),
      ('fn_check_transaction_status', $f$s.direction = 'both' or s.direction = new.direction$f$,
                                $f$s.direction = 'both' or s.direction = (case when new.source_account_id is not null then 'out' else 'in' end)$f$, 1),
      -- ...and the same value again in the error message it raises.
      ('fn_check_transaction_status', $f$new.status, new.direction$f$,
                                $f$new.status, (case when new.source_account_id is not null then 'out' else 'in' end)$f$, 1),

      -- portal_transaction_edit asked the row which way it went in order to
      -- decide WHICH ACCOUNT COLUMN to write - reading the shadow to decide
      -- where to put the substance. Now it reads the substance.
      ('portal_transaction_edit', $f$coalesce(t.direction,'out')$f$,
                                $f$(case when t.source_account_id is not null then 'out' else 'in' end)$f$, 3),
      ('portal_transaction_edit', $f$coalesce(t.direction, 'out')$f$,
                                $f$(case when t.source_account_id is not null then 'out' else 'in' end)$f$, 2),
      ('fn_actions_settle_payment_notice',
                                $f$select direction into v_dir from public.transactions where id = v_txn;$f$,
                                $f$select case when source_account_id is not null then 'out' else 'in' end into v_dir from public.transactions where id = v_txn;$f$, 1),
      ('fn_transactions_notify_task', $f$NEW.direction$f$,
                                $f$(case when NEW.source_account_id is not null then 'out' else 'in' end)$f$, 6),

      -- Still handed to the task screen under the same key, so the UI keeps
      -- working while it is being rewritten - it is simply computed now.
      ('portal_task_detail',    $f$'direction', t.direction$f$,
                                $f$'direction', case when t.source_account_id is not null then 'out' else 'in' end$f$, 1),
      ('portal_task_money',     $f$coalesce(t.direction, 'out') as dir$f$,
                                $f$case when t.source_account_id is not null then 'out' else 'in' end as dir$f$, 1)
    ) as v(fn, pat, rep, hits)
  loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = j.fn;

    if src is null then
      raise exception 'PATCH_NO_FUNCTION: public.% does not exist', j.fn;
    end if;

    found := (length(src) - length(replace(src, j.pat, ''))) / length(j.pat);
    if found <> j.hits then
      raise exception 'PATCH_COUNT: % in % appears % time(s), expected %',
        j.pat, j.fn, found, j.hits;
    end if;

    patched := replace(src, j.pat, j.rep);
    execute patched;
  end loop;
end $patch$;

-- Prove it: no function may mention transactions.direction through any alias
-- these functions actually use. (messages.direction, contracts.direction and
-- stage_settlements.direction are none of this migration's business, and are
-- deliberately not matched.)
do $$
declare n int; names text;
begin
  select count(*), string_agg(p.proname, ', ')
    into n, names
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     -- fn_transactions_direction is the one place allowed to say the word: it
     -- is the trigger that DERIVES direction from the accounts. 093 retires it
     -- along with the column.
     and p.proname <> 'fn_transactions_direction'
     and pg_get_functiondef(p.oid) ~ '(\mt\.direction|\mtr\.direction|\mtt\.direction|\mtx\.direction|\mt2\.direction|\mz\.direction|NEW\.direction|new\.direction)';
  if n > 0 then
    raise exception 'STILL_READING_DIRECTION: %', names;
  end if;
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
