-- 155. AWARDED MEANS AWARDED.
--
-- Shahar (2026-09-16), on Finance under New build: "daniel meidan helped me
-- secure finance with mortgage company. he is a mortgage broker. i already
-- awarded it to him, yet, when i look into the finance panel, this is what i
-- find" - the panel saying "Nobody is appointed for finance yet."
--
-- Two migrations disagreed. The award screen (106) wrote a PLACEHOLDER
-- contract behind the seat, on the grounds that "saying the work is his and
-- settling the terms are two different conversations". The spine (147)
-- counts a trade as appointed only under a signed, awarded or active
-- contract. So pressing "Award it" produced a contract the spine refused to
-- call an award, and the screen you had just used sent you back to use it
-- again. Daniel Meidan and Franklin Moreno both went through that door.
--
-- 106 had the right idea about the TERMS and the wrong word for the STATUS.
-- The work being theirs is exactly what "awarded" means; the amount being
-- null is what says the terms are still open. So an award now leaves the
-- contract 'awarded' with the date, the amount stays empty until the money
-- screen fills it, and every screen that used to read "placeholder" as
-- "terms not agreed" reads the empty amount instead. The two contracts the
-- screen already wrote are corrected here.
--
-- Also: portal_award_board says which trades a contract's party works, so
-- the award screen can offer "Construction loan note (ClearEdge Lending)" -
-- a contract with no trade on it - under Finance, because ClearEdge does
-- finance. Shahar: "i see none related contracts which makes it hard to
-- find the right one."
--
-- No signature changes; every function here is CREATE OR REPLACE'd in place.

-- ---------------------------------------------------------------------------
-- 1. portal_award_trade: the contract behind a direct award is 'awarded'.
-- ---------------------------------------------------------------------------
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef('public.portal_award_trade(uuid, uuid, text, text, uuid)'::regprocedure) into src;
  out_ := replace(src,
    $a$  return jsonb_build_object('ok', true, 'seated', v_made, 'member_id', v_member,$a$,
    $b$  -- AWARDED MEANS AWARDED (155). A placeholder behind an awarded seat is
  -- the spine's "nobody is appointed", one screen after you appointed them.
  -- The status says whose the work is; the empty amount says the terms are
  -- still open. Never touches a contract that is already further along.
  update public.contracts
     set status = 'awarded', awarded_date = coalesce(awarded_date, current_date)
   where id = v_contract and status = 'placeholder';

  return jsonb_build_object('ok', true, 'seated', v_made, 'member_id', v_member,$b$);
  if out_ = src then raise exception 'portal_award_trade has drifted'; end if;
  execute out_;
end $patch$;

-- The two contracts the award screen wrote before this - Daniel Meidan
-- (Finance, today) and Franklin Moreno (Electrical, 2026-09-14). The seat
-- backfill of 2026-09-01 is a different story (154) and is left alone.
update public.contracts c
   set status = 'awarded',
       awarded_date = coalesce(c.awarded_date,
                               (select min(pm.joined_on) from public.project_members pm
                                 where pm.contract_id = c.id), c.created_at::date)
 where c.status = 'placeholder'
   and c.created_by = 'system: seat'
   and exists (select 1 from public.project_members pm
                where pm.contract_id = c.id and pm.status = 'active');

-- ---------------------------------------------------------------------------
-- 2. portal_award_board: the party's trades on each contract; the amount on
--    each seat's contract, so "terms not agreed" can be read off it.
-- ---------------------------------------------------------------------------
do $patch$
declare src text; out_ text; step text;
begin
  select pg_get_functiondef('public.portal_award_board(uuid)'::regprocedure) into src;
  out_ := src;

  step := 'party_trades';
  out_ := replace(out_,
    $a$               'seats', (select count(*) from public.project_members pm
                          where pm.contract_id = c.id and pm.status = 'active'))$a$,
    $b$               'seats', (select count(*) from public.project_members pm
                          where pm.contract_id = c.id and pm.status = 'active'),
               -- What the contract's party does, for a contract that names no
               -- trade itself: the loan note is a finance contract because the
               -- lender does finance (155).
               'party_trades', coalesce((
                 select jsonb_agg(distinct x.trade) from (
                   select r.trade from public.contact_trade_roles r
                    where r.contact_id in (c.contractor_id, c.counterparty_contact_id)
                   union all
                   select r2.trade from public.company_trade_roles r2
                    where r2.company_id = c.counterparty_company_id) x), '[]'::jsonb))$b$);
  if out_ = src then raise exception 'portal_award_board has drifted at %', step; end if;
  src := out_;

  step := 'contract_amount';
  out_ := replace(out_,
    $a$               'contract_status', c.status,$a$,
    $b$               'contract_status', c.status,
               'contract_amount', c.amount,$b$);
  if out_ = src then raise exception 'portal_award_board has drifted at %', step; end if;

  execute out_;
end $patch$;

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
