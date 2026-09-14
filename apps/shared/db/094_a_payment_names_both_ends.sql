-- 094 - A payment names both ends.
--
-- Shahar (2026-09-14): "no transaction can be logged without naming clearly
-- the source and destination (trigger reject). optionally, the transaction can
-- be tied to a task or project."
--
-- And on what the far end is: "Normally its [one of my accounts to the
-- contact], however, in the case of a credit, the source can be the
-- supplier/trade and the target can be me."
--
-- So a payment always runs between ONE of your money accounts and ONE OR MORE
-- counterparties, and which side your account sits on is the whole of the
-- direction:
--
--   55 Walnut Drive  ->  Kuiken Brothers      you paid them
--   CSAA Insurance   ->  55 Walnut Drive      they paid you back
--
-- Your end is source_account_id or destination_account_id. Their end is
-- transaction_targets (migration 091), which is why it can be several - one
-- check covering the framer and the lumber yard names two.
--
-- Scope, at his instruction: "New and edited rows only". The rules fire on
-- insert, and on an update ONLY when someone actually moves the ends. Editing
-- an amount, a date or a note on one of the 87 old rows that has no
-- counterparty yet still works, so the 254 Concord ledger stays readable and
-- fixable until task f9ee72ce is done.

-- ---------------------------------------------------------------- your end --
-- Was: reject two accounts, otherwise derive the direction. Now it also
-- rejects NO account, which was the quiet case - a payment that came from
-- nowhere, which is how 87 rows got into the state migration 090 had to dig
-- them out of.
create or replace function public.fn_transactions_direction()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if NEW.source_account_id is not null and NEW.destination_account_id is not null then
    raise exception 'TRANSFER_UNSUPPORTED: name one of your accounts, not two. Money moving between two of your own accounts is a transfer, and the ledger needs a status that means "neither paid nor received" before it can hold one.'
      using errcode = '23514';
  elsif NEW.source_account_id is not null then
    NEW.direction := 'out';
  elsif NEW.destination_account_id is not null then
    NEW.direction := 'in';
  else
    raise exception 'ACCOUNT_REQUIRED: say which of your accounts this money left, or which one it landed in. A payment with neither end cannot be reconciled against anything.'
      using errcode = '23514';
  end if;
  return NEW;
end $function$;

-- --------------------------------------------------------------- their end --
-- Every path that names a contractor gets its counterparty for free, so no
-- caller has to remember two writes: task_payment_log, fin_payment_log, the
-- portal's own inserts and any hand-written fix all land the same way.
create or replace function public.fn_transactions_target_from_contractor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.contractor_id is not null
     and not exists (select 1 from public.transaction_targets g
                      where g.transaction_id = NEW.id and g.contact_id = NEW.contractor_id) then
    insert into public.transaction_targets (transaction_id, contact_id, created_by)
    values (NEW.id, NEW.contractor_id, coalesce(NEW.created_by, 'trigger'))
    on conflict do nothing;
  end if;
  return null;
end $function$;

drop trigger if exists trg_transactions_target_from_contractor on public.transactions;
create trigger trg_transactions_target_from_contractor
  after insert or update of contractor_id on public.transactions
  for each row execute function public.fn_transactions_target_from_contractor();

-- The counterparty cannot be checked in a BEFORE trigger: transaction_targets
-- points AT the transaction, so the rows arrive after it exists. A deferred
-- constraint trigger asks the question at commit, by which time both halves
-- are in.
create or replace function public.fn_transactions_need_counterparty()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- "New and edited rows only." An update that leaves both ends exactly where
  -- they were is none of this rule's business.
  if TG_OP = 'UPDATE'
     and NEW.source_account_id      is not distinct from OLD.source_account_id
     and NEW.destination_account_id is not distinct from OLD.destination_account_id
     and NEW.contractor_id          is not distinct from OLD.contractor_id then
    return null;
  end if;

  if not exists (select 1 from public.transaction_targets g where g.transaction_id = NEW.id) then
    raise exception 'COUNTERPARTY_REQUIRED: say who the other side was - who you paid, or who paid you. % is only one end of it.',
      coalesce(nullif(btrim(NEW.description), ''), 'This payment')
      using errcode = '23514';
  end if;
  return null;
end $function$;

drop trigger if exists trg_transactions_need_counterparty on public.transactions;
create constraint trigger trg_transactions_need_counterparty
  after insert or update on public.transactions
  deferrable initially deferred
  for each row execute function public.fn_transactions_need_counterparty();

-- A counterparty cannot be taken away and leave the payment with one end.
create or replace function public.fn_transaction_targets_keep_one()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if exists (select 1 from public.transactions t where t.id = OLD.transaction_id)
     and not exists (select 1 from public.transaction_targets g
                      where g.transaction_id = OLD.transaction_id) then
    raise exception 'COUNTERPARTY_REQUIRED: that was the last party on this payment. Name the right one before removing the wrong one.'
      using errcode = '23514';
  end if;
  return null;
end $function$;

drop trigger if exists trg_transaction_targets_keep_one on public.transaction_targets;
create constraint trigger trg_transaction_targets_keep_one
  after delete on public.transaction_targets
  deferrable initially deferred
  for each row execute function public.fn_transaction_targets_keep_one();

-- --------------------------------------------------------- naming a person --
-- The portal logs some payments by direct insert rather than through
-- task_payment_log, and matched the payee only against people already on the
-- project - a miss left contractor_id null and the payment anonymous. Same
-- find-or-create rule as everywhere else, in one place both can call.
create or replace function public.contact_for_name(p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text := nullif(btrim(p_name), ''); v_id uuid; n int;
begin
  if v_name is null then return null; end if;

  select count(*) into n from public.contacts c
   where c.disabled_at is null and lower(coalesce(c.person_name, c.name)) = lower(v_name);
  if n > 1 then
    raise exception 'AMBIGUOUS_CONTACT: there is more than one "%" on file. Pick the right one from the list.', v_name
      using errcode = '23505';
  end if;

  select c.id into v_id from public.contacts c
   where c.disabled_at is null and lower(coalesce(c.person_name, c.name)) = lower(v_name) limit 1;
  if v_id is null then
    insert into public.contacts (name, person_name, source, created_by, notes)
    values (v_name, v_name, 'payment', 'portal:payment',
            'Created when money was logged on ' || to_char(current_date, 'YYYY-MM-DD')
            || '. Nothing is known about them beyond the name.')
    returning id into v_id;
  end if;
  return v_id;
end $function$;

grant execute on function public.contact_for_name(text) to authenticated;

-- Prove the rules hold on what is already there before letting them loose.
do $$
declare n int;
begin
  select count(*) into n from public.transactions
   where num_nonnulls(source_account_id, destination_account_id) <> 1;
  if n > 0 then
    raise exception 'YOUR_END: % existing payments name no account, or two', n;
  end if;
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
