-- 088  55 WALNUT DRIVE FUNDS THE JOB
--
-- Shahar (2026-09-14), asked per group about the 62 rows on 55 Walnut with no
-- account on either side - the $1,209,000 purchase, 13 mortgage payments to
-- ClearEdge Lending, 15 tax payments to Tenafly, and 25 trade payments -
-- answered all four the same way: 55 Walnut Drive. Then, correcting me:
-- "No, its the 55 Walnut drive bank account, not the card."
--
-- That correction undoes an inference of mine. In 087 I recorded the account
-- as kind 'card', off his earlier phrase "the 55 Walnut card". A $1,209,000
-- house purchase does not go on a card, and I should have treated that as the
-- contradiction it was rather than carrying the guess forward. It is a BANK
-- ACCOUNT, named the way he names it.
--
-- WHY THE NOTIFY TRIGGER IS SUSPENDED FOR THE BACKFILL, and only for it.
--
-- fn_transactions_notify_task fires on UPDATE as well as INSERT, and its
-- "already settled, nobody is waiting" exemption is written for TG_OP =
-- 'INSERT' only. So touching 62 rows whose status means the money moved would
-- have inserted up to 62 High-priority "Awaiting confirmation from..." tasks
-- and flipped every 'paid' row to 'paid - pending confirmation'. Recording
-- which account funded a payment is not news to anybody - it is bookkeeping
-- about a payment that already happened.
--
-- Checked first whether 087's smaller backfill had already done this: 0 notice
-- tasks were created today, and the 3 rows sitting in 'pending confirmation'
-- were put there by a session at 01:41 and already had their tasks, so the
-- on-conflict guard held. No harm done - but 23 rows got lucky where 62 would
-- not have.

update public.money_accounts
   set name = '55 Walnut Drive',
       kind = 'bank',
       last_modified_at = now(),
       last_modified_by = 'claude',
       notes = 'The bank account the property is run from: the purchase, the mortgage, the taxes and the trades all draw on it (Shahar, 2026-09-14). Recorded as "55 Walnut", "55 Walnut Dr" and once as "Credit card" before accounts were rows; all three resolve here. Kind was wrongly recorded as a card in 087 - a $1.2M purchase does not go on one.'
 where lower(name) = '55 walnut';

insert into public.money_account_aliases (alias, account_id, note)
select '55 walnut drive', id, 'The name itself.'
  from public.money_accounts where lower(name) = '55 walnut drive'
 on conflict (alias) do nothing;

alter table public.transactions disable trigger trg_transactions_notify_upd;

update public.transactions t
   set source_account_id = (select id from public.money_accounts where lower(name) = '55 walnut drive'),
       paid_from_account = '55 Walnut Drive'
  from public.projects p
 where p.id = t.project_id
   and coalesce(p.status, '') not like 'Closed%'
   and t.project_id in (select project_id from public.fin_family('a62c81d4-8cd3-4450-83b7-29cbbd65ab84'))
   and t.source_account_id is null and t.destination_account_id is null
   and coalesce(t.direction, 'out') = 'out';

-- The one incoming row - Ben Donohue's $559 insurance refund - landed IN the
-- account, so it fills the destination slot. Exactly the distinction
-- paid_from_account could never make.
update public.transactions t
   set destination_account_id = (select id from public.money_accounts where lower(name) = '55 walnut drive'),
       paid_from_account = '55 Walnut Drive'
  from public.projects p
 where p.id = t.project_id
   and coalesce(p.status, '') not like 'Closed%'
   and t.project_id in (select project_id from public.fin_family('a62c81d4-8cd3-4450-83b7-29cbbd65ab84'))
   and t.source_account_id is null and t.destination_account_id is null
   and t.direction = 'in';

alter table public.transactions enable trigger trg_transactions_notify_upd;

-- Verified after: 0 notice tasks created today, 0 rows left without an account
-- on the 55 Walnut family, 84 sourced and 1 destinationed, the count of
-- 'paid - pending confirmation' unchanged at 3, all seven triggers re-enabled.

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
