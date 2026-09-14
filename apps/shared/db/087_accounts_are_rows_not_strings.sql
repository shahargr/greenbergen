-- 087  ACCOUNTS ARE ROWS, NOT STRINGS
--
-- Shahar (2026-09-14): "do (b) - real account rows. for the accounts you don't
-- know, just ask me one by one. with 55 walnut, is there any question about
-- source and target for payments? if so, start with these."
--
-- On 55 Walnut the TARGET is never in question - every transaction names who
-- was paid. The SOURCE is missing on 57 rows, including the $1,209,000
-- purchase, thirteen mortgage payments to ClearEdge Lending and fifteen tax
-- payments to Tenafly. And where a source WAS recorded it had already drifted:
-- George Orellana alone is paid from three different strings -
-- "55 Walnut" (5 rows), "55 Walnut Dr" (3) and "Credit card" (2) - which are
-- all the same card.
--
-- That is what a free-text column does. paid_from_account held five distinct
-- values across 173 rows and three of them were the same account, one of them
-- was a payment RAIL in the account field, and 98 rows had nothing at all.
--
-- WHAT HE SETTLED, asked one by one:
--   55 Walnut / 55 Walnut Dr   one account, two spellings
--   Credit card                the same 55 Walnut card - the rail got typed in
--   Shahar personal            a catch-all for his own money across several
--                              real accounts; kept whole and FLAGGED to split
--                              rather than guessed at
--   the 57 with no source      he will say per group - purchase, mortgage,
--                              taxes, trades - so nothing is invented here
--
-- WHY THIS MATTERS BEYOND TIDINESS. Until now direction was the ONLY thing
-- that knew which way money went: paid_from_account is named "from" and
-- bakes in the assumption that your account is the SOURCE, which is false on
-- every incoming row. With two real slots the order is explicit, and
-- direction becomes derived instead of typed (see fn_transactions_direction
-- at the foot of this file).

-- ---------------------------------------------------------------------------
-- YOUR ACCOUNTS. Only ever your side of a transaction - the counterparty
-- stays contractor_id, and the two account tables that already exist are both
-- about them (payee_accounts is where you send money TO a payee;
-- supplier_accounts is your trade account WITH a supplier).
create table if not exists public.money_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'other'
    check (kind in ('bank', 'card', 'cash', 'escrow', 'loan', 'other')),
  -- Whose money it is. Free text: 'Shahar', 'Net Positive LLC'. Not a company
  -- FK - companies in this database are counterparties, not us.
  owner text,
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  -- An account dedicated to one property, when it is one.
  project_id uuid references public.projects(id) on delete set null,
  is_active boolean not null default true,
  -- A catch-all standing in for several real accounts. Kept whole so nothing
  -- is lost, and marked so it is obvious it still has to be broken up.
  needs_split boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  created_by text default 'claude',
  last_modified_at timestamptz,
  last_modified_by text
);
create unique index if not exists uq_money_accounts_name on public.money_accounts (lower(name));

comment on table public.money_accounts is
  'Your own accounts - the side of a transaction that is yours. The counterparty is contractor_id. Replaces the free-text transactions.paid_from_account (087).';

-- ---------------------------------------------------------------------------
-- WHAT PEOPLE TYPED, AND WHAT IT MEANT. An alias table rather than a rename:
-- the old strings stay readable in the history, and the next person who types
-- "55 Walnut Dr" lands on the right account instead of creating a sixth one.
create table if not exists public.money_account_aliases (
  alias text primary key,
  account_id uuid not null references public.money_accounts(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
comment on table public.money_account_aliases is
  'Lower-cased spellings that resolve to an account. "55 walnut dr" and "credit card" both meant the 55 Walnut card.';

-- ---------------------------------------------------------------------------
-- THE THREE ACCOUNTS 55 WALNUT ACTUALLY USED.
insert into public.money_accounts (name, kind, owner, project_id, needs_split, notes)
select '55 Walnut', 'card', 'Shahar',
       (select id from public.projects where project_name = '55 Walnut Drive' and trashed_at is null limit 1),
       false,
       'The card the property is paid on. Recorded as "55 Walnut", "55 Walnut Dr" and once as "Credit card" before accounts were rows; all three resolve here (Shahar, 2026-09-14).'
where not exists (select 1 from public.money_accounts where lower(name) = '55 walnut');

insert into public.money_accounts (name, kind, owner, needs_split, notes)
select 'Shahar personal', 'other', 'Shahar', true,
       'A CATCH-ALL, not one account: 54 rows and $643,895 from 2015 to 2026 across several real accounts. Kept whole so nothing is lost; needs_split says it is still to be broken up (Shahar, 2026-09-14).'
where not exists (select 1 from public.money_accounts where lower(name) = 'shahar personal');

insert into public.money_accounts (name, kind, owner, notes)
select 'Net Positive LLC', 'bank', 'Net Positive LLC',
       'One row, $55. Kind assumed to be a bank account - correct it if it is a card.'
where not exists (select 1 from public.money_accounts where lower(name) = 'net positive llc');

insert into public.money_account_aliases (alias, account_id, note)
select v.alias, a.id, v.note
  from (values
    ('55 walnut',        '55 Walnut',        'The name itself.'),
    ('55 walnut dr',     '55 Walnut',        'Second spelling of the same card.'),
    ('credit card',      '55 Walnut',        'A payment RAIL typed into the account field; both rows were the 55 Walnut card.'),
    ('shahar personal',  'Shahar personal',  'The name itself.'),
    ('net positive llc', 'Net Positive LLC', 'The name itself.')
  ) as v(alias, acct, note)
  join public.money_accounts a on lower(a.name) = lower(v.acct)
 where not exists (select 1 from public.money_account_aliases x where x.alias = v.alias);

-- ---------------------------------------------------------------------------
-- TWO SLOTS ON A TRANSACTION, and the ORDER is the direction.
alter table public.transactions
  add column if not exists source_account_id uuid references public.money_accounts(id) on delete set null,
  add column if not exists destination_account_id uuid references public.money_accounts(id) on delete set null;
create index if not exists idx_transactions_source on public.transactions (source_account_id)
  where source_account_id is not null;
create index if not exists idx_transactions_destination on public.transactions (destination_account_id)
  where destination_account_id is not null;

comment on column public.transactions.source_account_id is
  'Which of YOUR accounts the money left. Set on an outgoing payment; null on an incoming one, where the counterparty is the source.';
comment on column public.transactions.destination_account_id is
  'Which of YOUR accounts the money landed in. Set on an incoming credit; null on an outgoing payment.';

-- THE BACKFILL, and what it deliberately leaves alone.
--
-- An outgoing row's account was the SOURCE; an incoming row's was the
-- DESTINATION - the very fact "paid_from_account" could not express, and the
-- reason direction had to exist at all.
--
-- 75 rows carry an account string and only 23 are touched. The other 51 are
-- all on 254 Concord, which is Closed - Completed: the first attempt at this
-- migration was refused by fn_block_completed_project_writes, and it was
-- right to be. A closed job's ledger is frozen. Those rows keep their string
-- and their stored direction, and portal_payment_accounts below resolves
-- them through the alias table without writing anything, so the account list
-- stays complete either way.
update public.transactions t
   set source_account_id = al.account_id
  from public.money_account_aliases al, public.projects p
 where p.id = t.project_id
   and coalesce(p.status, '') not like 'Closed%'
   and lower(btrim(t.paid_from_account)) = al.alias
   and coalesce(t.direction, 'out') = 'out'
   and t.source_account_id is null;

update public.transactions t
   set destination_account_id = al.account_id
  from public.money_account_aliases al, public.projects p
 where p.id = t.project_id
   and coalesce(p.status, '') not like 'Closed%'
   and lower(btrim(t.paid_from_account)) = al.alias
   and t.direction = 'in'
   and t.destination_account_id is null;

-- ---------------------------------------------------------------------------
-- DIRECTION IS DERIVED NOW, where the slots say so.
--
-- Not a GENERATED column: 98 rows have no account on either side and their
-- direction is a real fact that must survive, so the rule has to be "derive
-- when you can, keep what you were given otherwise" - which a generated
-- column cannot express.
--
-- An account on both sides is a transfer between two of your own accounts.
-- The status vocabulary has no word for that yet (every status in
-- transaction_statuses is in, out or both, and 'paid to nobody' is not a
-- state), so it is refused here rather than half-built.
create or replace function public.fn_transactions_direction()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if NEW.source_account_id is not null and NEW.destination_account_id is not null then
    raise exception 'TRANSFER_UNSUPPORTED: moving money between two of your own accounts is not supported yet - it needs a status that means "neither paid nor received".'
      using errcode = '23514';
  elsif NEW.source_account_id is not null then
    NEW.direction := 'out';
  elsif NEW.destination_account_id is not null then
    NEW.direction := 'in';
  end if;
  -- Neither set: leave whatever was given. That is the 98 legacy rows, and
  -- every new row until both sides are always recorded.
  return NEW;
end $function$;

drop trigger if exists trg_transactions_direction on public.transactions;
create trigger trg_transactions_direction
  before insert or update of source_account_id, destination_account_id, direction
  on public.transactions
  for each row execute function public.fn_transactions_direction();

comment on function public.fn_transactions_direction() is
  'Derives transactions.direction from which slot holds your account. Keeps the stored value when neither does; refuses an account on both sides until transfers have a status.';

-- ---------------------------------------------------------------------------
-- The accounts a job has used, now from rows rather than distinct strings.
-- Same name and shape as migration 075's, so the payment box needs no change
-- until it moves to ids.
create or replace function public.portal_payment_accounts(p_project uuid)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  with fam as (select project_id from public.fin_family(p_project)),
  used as (
    select a.name, max(t.paid_on) as last_used, count(*) as n
      from public.transactions t
      join fam on fam.project_id = t.project_id
      join public.money_accounts a
        on a.id = coalesce(
             t.source_account_id,
             t.destination_account_id,
             -- A frozen project's rows were never rewritten, so resolve their
             -- old string here instead.
             (select al.account_id from public.money_account_aliases al
               where al.alias = lower(btrim(t.paid_from_account))))
     where public.fin_may_record(t.project_id)
       and a.is_active
     group by a.name
  )
  select coalesce(jsonb_agg(name order by last_used desc nulls last, n desc), '[]'::jsonb) from used;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();

-- ---------------------------------------------------------------------------
-- 087c  LOGGING A PAYMENT NAMES A REAL ACCOUNT.
--
-- Shahar's original ask for this field (migration 075) was that it "starts
-- with nothing, but as data progress it is added to a drop down
-- automatically". That behaviour survives - the list still fills itself - but
-- it fills with ROWS now, so the sixth spelling of one card resolves to the
-- card instead of becoming a sixth account.
create or replace function public.money_account_resolve(p_name text, p_project uuid default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_name text := nullif(btrim(p_name), ''); v_id uuid;
begin
  if v_name is null then return null; end if;

  select account_id into v_id from public.money_account_aliases where alias = lower(v_name);
  if v_id is not null then return v_id; end if;

  select id into v_id from public.money_accounts where lower(name) = lower(v_name);
  if v_id is not null then
    insert into public.money_account_aliases (alias, account_id, note)
    values (lower(v_name), v_id, 'Matched the account name exactly.')
    on conflict (alias) do nothing;
    return v_id;
  end if;

  -- New to us. Kind is unknown rather than guessed - somebody can say later
  -- whether it is a card, a bank account or cash.
  insert into public.money_accounts (name, kind, project_id, created_by, notes)
  values (v_name, 'other', p_project, 'portal:payment',
          'Created the first time a payment named it. Kind and owner are not known yet.')
  returning id into v_id;
  insert into public.money_account_aliases (alias, account_id, note)
  values (lower(v_name), v_id, 'The name itself.') on conflict (alias) do nothing;
  return v_id;
end $function$;

revoke all on function public.money_account_resolve(text, uuid) from public, anon;
grant execute on function public.money_account_resolve(text, uuid) to authenticated;

-- task_payment_log fills the right SLOT as well as the string, and
-- portal_transaction_edit moves the slot when the account is corrected -
-- otherwise an edit would leave the string and the slot disagreeing. Both
-- patched in place rather than restated; the string stays for now so nothing
-- that reads it breaks.
do $patch$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'task_payment_log';
  if src is null then raise exception 'task_payment_log not found'; end if;
  if position('money_account_resolve' in src) > 0 then
    raise notice 'already names a real account'; return;
  end if;
  patched := replace(src,
    'insert into public.transactions
    (id, description, amount, paid_on, direction, status, project_id, action_id, contractor_id,
     payment_method_id, payment_reference, paid_from_account, notes, currency, created_by, last_modified_by)',
    'insert into public.transactions
    (id, description, amount, paid_on, direction, status, project_id, action_id, contractor_id,
     payment_method_id, payment_reference, paid_from_account, notes, currency, created_by, last_modified_by,
     source_account_id, destination_account_id)');
  if patched = src then raise exception 'insert column list not found - patch by hand'; end if;
  patched := replace(patched,
    $old$     nullif(btrim(p_notes), ''), 'USD', 'portal:task-payment', 'portal:task-payment');$old$,
    $new$     nullif(btrim(p_notes), ''), 'USD', 'portal:task-payment', 'portal:task-payment',
     case when v_in then null else public.money_account_resolve(p_from_account, a.project_id) end,
     case when v_in then public.money_account_resolve(p_from_account, a.project_id) else null end);$new$);
  if patched = src then raise exception 'insert values tail not found - patch by hand'; end if;
  execute patched;
end $patch$;

do $patch$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_transaction_edit';
  if src is null then raise exception 'portal_transaction_edit not found'; end if;
  if position('money_account_resolve' in src) > 0 then
    raise notice 'already moves the slot'; return;
  end if;
  patched := replace(src,
    $old$      update public.transactions set paid_from_account = nullif(btrim(p_patch->>'from_account'), '') where id = p_id;$old$,
    $new$      update public.transactions
         set paid_from_account = nullif(btrim(p_patch->>'from_account'), ''),
             source_account_id = case when coalesce(t.direction,'out') = 'out'
               then public.money_account_resolve(p_patch->>'from_account', t.project_id) else null end,
             destination_account_id = case when coalesce(t.direction,'out') = 'in'
               then public.money_account_resolve(p_patch->>'from_account', t.project_id) else null end
       where id = p_id;$new$);
  if patched = src then raise exception 'from_account update not found - patch by hand'; end if;
  execute patched;
end $patch$;

-- Verified in rolled-back probes:
--   "55 Walnut Dr" on a payment  -> source = 55 Walnut,      direction out
--   "55 Walnut"    on a credit   -> destination = 55 Walnut,  direction in
--   a name nobody had used       -> account created, 3 -> 4, joins the list
--   portal_payment_accounts      -> ["55 Walnut", "Chase checking ·9012",
--                                    "Shahar personal"] - the three drifted
--                                    spellings now read as one account
--   an account in BOTH slots     -> TRANSFER_UNSUPPORTED
