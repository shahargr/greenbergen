-- 089  NET POSITIVE LLC IS A CARD, AND A BACKFILL NEEDS A LEFT JOIN
--
-- Shahar (2026-09-14): "show me net positive llc row". Looking at it turned up
-- two mistakes of mine, both visible in the row itself.
--
-- ONE. I recorded the account as kind 'bank' with the note "correct it if it
-- is a card" - while summarising a row that answers the question three times:
--
--   method             Credit card
--   payment_reference  "CC ending 0373"
--   notes              "Paid on Net Positive LLC card ending 0373."
--
-- It is a card, and the last four were there to be recorded. Writing "correct
-- it if" is not a substitute for reading what is in front of me.
--
-- TWO. That row was never backfilled in 087, because of a join. The backfill
-- wrote
--
--     from public.money_account_aliases al, public.projects p
--    where p.id = t.project_id and p.status not like 'Closed%'
--
-- which is an INNER join to projects. This transaction has no project_id - it
-- hangs off a CONTRACT instead (Optimum internet for 52 Ryerson) - so a guard
-- meant to skip FROZEN projects silently skipped every row with NO project.
-- Exactly one row in the table is in that position, and it is the one he asked
-- to see. NOT EXISTS says what was meant: skip a row only when its project is
-- actually closed.
--
-- A prediction I got wrong on the way, worth recording: I expected this update
-- to be refused by chk_transactions_payment_complete, since the row has no
-- project and no contractor. It has a CONTRACT, which satisfies the other
-- branch of that constraint. Checked before writing rather than asserted.

update public.money_accounts
   set kind = 'card',
       last4 = '0373',
       last_modified_at = now(),
       last_modified_by = 'claude',
       notes = 'The Net Positive LLC credit card ending 0373. Recorded as a bank account in 087 on an assumption; the transaction it came from said "Credit card", "CC ending 0373" and "Paid on Net Positive LLC card ending 0373" (corrected 2026-09-14).'
 where lower(name) = 'net positive llc';

-- The row's status means the money moved, so an UPDATE would otherwise have
-- fn_transactions_notify_task open an "Awaiting confirmation" task about a
-- bill paid and receipted in August (see 088 for why that trigger has to be
-- held off for bookkeeping backfills).
alter table public.transactions disable trigger trg_transactions_notify_upd;

update public.transactions t
   set source_account_id = al.account_id
  from public.money_account_aliases al
 where lower(btrim(t.paid_from_account)) = al.alias
   and coalesce(t.direction, 'out') = 'out'
   and t.source_account_id is null
   and t.destination_account_id is null
   and not exists (select 1 from public.projects p
                    where p.id = t.project_id and coalesce(p.status,'') like 'Closed%');

update public.transactions t
   set destination_account_id = al.account_id
  from public.money_account_aliases al
 where lower(btrim(t.paid_from_account)) = al.alias
   and t.direction = 'in'
   and t.source_account_id is null
   and t.destination_account_id is null
   and not exists (select 1 from public.projects p
                    where p.id = t.project_id and coalesce(p.status,'') like 'Closed%');

alter table public.transactions enable trigger trg_transactions_notify_upd;

-- After: Net Positive LLC card ·0373 with 1 row; 55 Walnut Drive bank with 81
-- out and 1 in; Shahar personal with 3. 51 rows still hold only the old string
-- and all 51 are on 254 Concord, which is frozen - intentional. 0 notice tasks
-- created, 0 triggers left disabled.

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
