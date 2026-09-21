-- A PAYMENT LOGGED ON A TASK CAN NOW SAY WHICH CONTRACT AND WHICH BUDGET LINE.
--
-- READ 204 BEFORE THIS ONE. The last two lines of this migration reason that
-- leaving the old 14-argument function in place is a kindness to un-deployed
-- clients. It is not: Postgres then has two candidates for every call that
-- names only the original arguments, and answers 42725 "function is not
-- unique". That broke the quick task-and-payment box outright. 204 drops the
-- old signature. Kept here as applied, because a migration is a record.
--
-- Shahar, 2026-09-21, after logging $5,000 to his framer and finding it
-- nowhere: "where are the 5k, and how can we confirm they are counted as
-- framing payment and deducted from the balance."
--
-- They were counted nowhere. task_payment_log's insert names sixteen columns
-- and budget_category_id and contract_id are not among them, so EVERY payment
-- ever logged against a task has landed outside the budget by construction -
-- 22 of the 91 transactions on 55 Walnut's New build.
--
-- The task itself cannot supply the answer: the one in question had
-- contract_id, scope_item_id and pay_to_contact_id all null, and its only
-- signal, trade = 'Framing', maps to TWO lines here (Framing Labor and
-- Framing Materials). So this does not guess - it takes the answer and
-- checks it, and the form above it is what must ask.
--
-- Patched at two anchors rather than rewritten, because the live body has
-- drifted from the file that created it (it grew from/to account handling)
-- and a rewrite from the old source would silently revert that.
do $$
declare
  src  text := pg_get_functiondef('public.task_payment_log(uuid,numeric,uuid,uuid,text,text,date,text,text,text,boolean,uuid[],uuid,text)'::regprocedure);
  a_params constant text := 'p_to_account text DEFAULT NULL::text)';
  a_return constant text := E'  return jsonb_build_object(''ok'', true, ''transaction_id'', v_id,';
  out_sql text;
begin
  if (length(src) - length(replace(src, a_params, ''))) / length(a_params) <> 1 then
    raise exception 'parameter anchor matched % times, expected 1',
      (length(src) - length(replace(src, a_params, ''))) / length(a_params);
  end if;
  if (length(src) - length(replace(src, a_return, ''))) / length(a_return) <> 1 then
    raise exception 'return anchor matched % times, expected 1',
      (length(src) - length(replace(src, a_return, ''))) / length(a_return);
  end if;

  out_sql := replace(src, a_params,
    'p_to_account text DEFAULT NULL::text, p_contract uuid DEFAULT NULL::uuid, p_budget_category uuid DEFAULT NULL::uuid)');

  out_sql := replace(out_sql, a_return,
    E'  -- WHERE THIS MONEY LANDS. Both are optional, both are checked, and\n'
    '  -- neither is guessed: a contract or a budget line from another project\n'
    '  -- would quietly corrupt two balances at once.\n'
    '  if p_contract is not null and not exists (\n'
    '       select 1 from public.contracts c where c.id = p_contract and c.project_id = a.project_id) then\n'
    '    return jsonb_build_object(''ok'', false, ''reason'', ''That contract is not on this project.'');\n'
    '  end if;\n'
    '  if p_budget_category is not null and not exists (\n'
    '       select 1 from public.budget_categories bc where bc.id = p_budget_category and bc.project_id = a.project_id) then\n'
    '    return jsonb_build_object(''ok'', false, ''reason'', ''That budget line is not on this project.'');\n'
    '  end if;\n'
    '  if p_contract is not null or p_budget_category is not null then\n'
    '    update public.transactions\n'
    '       set contract_id        = coalesce(p_contract, contract_id),\n'
    '           budget_category_id = coalesce(p_budget_category, budget_category_id)\n'
    '     where id = v_id;\n'
    '  end if;\n'
    '\n' || a_return);

  execute out_sql;
end $$;

-- The new signature is a different function to Postgres, so it needs its own
-- grant; the old one keeps its own and is what any un-deployed client calls.
-- (WRONG - see the header. 204 drops the old signature.)
revoke all on function public.task_payment_log(uuid,numeric,uuid,uuid,text,text,date,text,text,text,boolean,uuid[],uuid,text,uuid,uuid) from public, anon;
grant execute on function public.task_payment_log(uuid,numeric,uuid,uuid,text,text,date,text,text,text,boolean,uuid[],uuid,text,uuid,uuid) to authenticated, service_role;
