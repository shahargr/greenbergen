-- 091 - A payment can have more than one other side.
--
-- Shahar (2026-09-14): "i'm ok with multiple values in the target on each
-- transaction." And on what a target is: "ideally, a contact or company.
-- since we are dealing with older transaction i classified as trader.
-- normally this cannot be the case."
--
-- So a target is a CONTACT. The trade names he typed on the old rows -
-- Framer, Mason, Lumber, Electrical - were a workaround for a 2015 ledger
-- that never recorded who was paid, not a second kind of target. This table
-- says so in its shape: contact_id is the answer, and `label` exists only to
-- hold a name we have not managed to turn into a contact yet. A row with a
-- label and no contact is an open question, not a filed answer.
--
-- Why a table rather than a column: a single payment can settle more than one
-- party - a check that covers the framer and the lumber yard, a closing wire
-- split between seller and attorney - and a column can only ever name one.
--
-- source_account_id already says which of HIS accounts the money left. This
-- says who it reached. Between them there is nothing left for `direction` to
-- tell anybody, which is the next migration's business.

create table if not exists public.transaction_targets (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete restrict,
  label           text,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      text default current_setting('sgr.app_user_id', true),
  -- A target has to name somebody. Either it is a contact, or it is a name we
  -- still owe a contact to.
  constraint chk_transaction_targets_named
    check (contact_id is not null or nullif(btrim(label), '') is not null),
  -- A label is the ABSENCE of a contact, never a nickname for one. Without
  -- this, "Framer" and Javier Rivera could sit on the same payment as two
  -- different parties and the money would look like it went out twice.
  constraint chk_transaction_targets_label_means_unknown
    check (contact_id is null or label is null)
);

comment on table public.transaction_targets is
  'Who a payment reached. A transaction may have several. contact_id is the real answer; a row carrying only a label is a party nobody has turned into a contact yet.';
comment on column public.transaction_targets.label is
  'Only for a party with no contact row. Once the contact exists, the label is replaced by contact_id - never kept alongside it.';

-- The same party cannot be on the same payment twice, by contact or by name.
create unique index if not exists ux_transaction_targets_contact
  on public.transaction_targets (transaction_id, contact_id) where contact_id is not null;
create unique index if not exists ux_transaction_targets_label
  on public.transaction_targets (transaction_id, lower(btrim(label))) where contact_id is null;
create index if not exists ix_transaction_targets_txn
  on public.transaction_targets (transaction_id);
create index if not exists ix_transaction_targets_contact
  on public.transaction_targets (contact_id) where contact_id is not null;

-- A target is as visible as the payment it hangs off, no more and no less.
alter table public.transaction_targets enable row level security;

drop policy if exists transaction_target_access on public.transaction_targets;
create policy transaction_target_access on public.transaction_targets
  for all
  using (exists (
    select 1 from public.transactions t
     where t.id = transaction_targets.transaction_id
       and public.can_see_money_on(t.project_id, t.contract_id)))
  with check (exists (
    select 1 from public.transactions t
     where t.id = transaction_targets.transaction_id
       and public.can_see_money_on(t.project_id, t.contract_id)));

-- BACKFILL, part one: every payment that already names a contractor.
--
-- This is the honest reading of what Shahar typed. On the 55 Walnut rows his
-- trade word and the contact agree and the contact is more precise: he wrote
-- "Framer" where the row already said Javier Rivera, "Mason" where it said
-- David Valdez, "Borough of tenafly" on all 16 rows that already pointed at
-- Borough of Tenafly - Accounts Receivable. Filing the trade word as the party
-- paid would be a downgrade. 85 rows.
--
-- Part two - the 88 older rows with no contractor at all, whose payee is
-- sitting in the description ("Home Depot - Carpentry", "84-LUMBER #1107") -
-- needs contacts that do not exist yet, so it waits for Shahar's word.
insert into public.transaction_targets (transaction_id, contact_id, created_by)
select t.id, t.contractor_id, 'migration:091'
  from public.transactions t
 where t.contractor_id is not null
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n
    from public.transactions t
   where t.contractor_id is not null
     and not exists (select 1 from public.transaction_targets g
                      where g.transaction_id = t.id and g.contact_id = t.contractor_id);
  if n > 0 then
    raise exception 'TARGET_BACKFILL_INCOMPLETE: % payments with a contractor got no target', n;
  end if;
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
