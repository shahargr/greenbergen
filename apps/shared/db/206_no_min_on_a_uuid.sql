-- There is no min(uuid) in Postgres, so the "exactly one live contract"
-- fallback in 205 threw 42883 the moment a trade had no payment history to
-- fall back FROM - which is precisely the case it exists for. Counted and
-- fetched separately instead.
create or replace function public.portal_trade_pay_defaults(p_project uuid, p_trade text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  t            public.transactions;
  v_contract   uuid;
  v_budget     uuid;
  v_payee      uuid;
  v_payee_name text;
  v_title      text;
  v_line       text;
  n            int;
begin
  -- The same gate as writing one: these are the fields of a payment form, and
  -- who was paid what is financial. Nothing leaks to a trade looking at their
  -- own row.
  if not public.fin_may_record(p_project) then return jsonb_build_object('ok', false); end if;

  -- THE LAST ONE. The trade's work can live on the job under the house, so
  -- the whole family is in scope - the same family the trade screen shows.
  select x.* into t
    from public.transactions x
    join public.actions a on a.id = x.action_id
   where x.project_id in (select project_id from public.fin_family(p_project))
     and a.trade = p_trade
   order by coalesce(x.paid_on, x.created_at::date) desc, x.created_at desc
   limit 1;

  v_payee    := t.contractor_id;
  v_contract := t.contract_id;
  v_budget   := t.budget_category_id;

  -- FAILING A PAYMENT, THE CONTRACT. Only when there is exactly one live one
  -- for this trade: two candidates is a question, not a default, and a
  -- silently wrong contract is worse than an empty field.
  if v_contract is null then
    select count(*) into n
      from public.contracts c
     where c.project_id in (select project_id from public.fin_family(p_project))
       and c.trade = p_trade
       and coalesce(c.status, '') not in ('complete', 'completed', 'cancelled', 'canceled', 'closed', 'draft');
    if n = 1 then
      select c.id into v_contract
        from public.contracts c
       where c.project_id in (select project_id from public.fin_family(p_project))
         and c.trade = p_trade
         and coalesce(c.status, '') not in ('complete', 'completed', 'cancelled', 'canceled', 'closed', 'draft');
    end if;
  end if;

  if v_contract is not null then
    select c.title, coalesce(v_budget, c.budget_category_id), coalesce(v_payee, c.contractor_id)
      into v_title, v_budget, v_payee
      from public.contracts c where c.id = v_contract;
  end if;

  if v_payee is not null then
    select coalesce(c.person_name, c.name) into v_payee_name
      from public.contacts c where c.id = v_payee and c.disabled_at is null;
    if v_payee_name is null then v_payee := null; end if;
  end if;
  if v_budget is not null then
    select bc.category into v_line from public.budget_categories bc where bc.id = v_budget;
  end if;

  return jsonb_build_object(
    'ok', true,
    'payee_contact_id', v_payee,
    'payee_name', v_payee_name,
    'from_account', t.paid_from_account,
    'method_id', t.payment_method_id,
    'contract_id', v_contract,
    'contract_title', v_title,
    'budget_category_id', v_budget,
    'budget_category', v_line);
end $function$;

revoke all on function public.portal_trade_pay_defaults(uuid, text) from public;
grant execute on function public.portal_trade_pay_defaults(uuid, text) to authenticated, service_role;
