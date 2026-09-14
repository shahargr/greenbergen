-- 094b - The account rule speaks before the status rule.
--
-- Postgres fires BEFORE triggers in NAME order, and trg_check_transaction_status
-- sorted ahead of trg_transactions_direction. So a payment with no account
-- named was refused with "paid is not a valid status for an in transaction" -
-- true, useless, and about the wrong thing: the status was fine, the account
-- was missing. The accounts decide the direction, so they have to be settled
-- before anything is judged against it.
alter table public.transactions rename constraint chk_transactions_direction to chk_transactions_direction_values;

drop trigger if exists trg_transactions_direction on public.transactions;
create trigger trg_00_transactions_accounts
  before insert or update of source_account_id, destination_account_id, direction
  on public.transactions
  for each row execute function public.fn_transactions_direction();

do $$
declare first_trigger text;
begin
  select tgname into first_trigger from pg_trigger
   where tgrelid = 'public.transactions'::regclass and not tgisinternal
     and (tgtype & 2) = 2
   order by tgname limit 1;
  if first_trigger <> 'trg_00_transactions_accounts' then
    raise exception 'ORDER: % still runs before the account rule', first_trigger;
  end if;
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
