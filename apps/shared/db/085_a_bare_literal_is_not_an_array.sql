-- 085  A BARE LITERAL IS NOT AN ARRAY
--
-- Shahar (2026-09-13), correcting an amount to 8314.98: "check this error
-- while updating a transaction and adding .98 to the amount"
--
--     Not saved.
--     malformed array literal: "amount"
--
-- Nothing to do with the decimal, and nothing to do with his data. It is a
-- type-resolution bug in portal_transaction_edit, and it has been there since
-- migration 073 wrote the function:
--
--     changed text[] := '{}';
--     ...
--     changed := changed || 'amount';
--
-- A quoted literal in Postgres has type UNKNOWN until something tells it
-- otherwise. Faced with `text[] || unknown`, the parser prefers
-- anycompatiblearray || anycompatiblearray over anyarray || anyelement, so it
-- tries to read the word amount AS AN ARRAY and fails:
--
--     ERROR: malformed array literal: "amount"
--     DETAIL: Array value must start with "{" or dimension information.
--
-- Every one of the eight field branches does this, so EDITING A PAYMENT HAS
-- NEVER WORKED except for one case: the status branch builds
-- ('marked ' || v_status), which is a known text expression rather than an
-- unknown literal, and resolves to anyarray || anyelement correctly. That is
-- why the only payment edit ever to succeed was the one Shahar reported
-- wanting on 2026-09-12 - marking a paid transaction refunded - and why every
-- attempt since to fix a number or a reference has been refused.
--
-- Checked the rest of the database for the same shape. close_action,
-- contractor_readiness and stage_payment_quote all build text[] the same way
-- and all of them write ::text on the literal. portal_transaction_edit is the
-- only one that does not.
--
-- The fix is the cast. Not array_append, which would work equally well - the
-- point is to keep the eight lines reading the way the rest of the database
-- reads, so the next person writing one copies a correct line.

do $patch$
declare
  src text; patched text; n int := 0;
  lit text;
  lits text[] := array[
    'what it was', 'amount', 'date', 'how it was paid',
    'reference', 'account', 'note', 'who was paid'];
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname = 'portal_transaction_edit';
  if src is null then raise exception 'portal_transaction_edit not found'; end if;

  patched := src;
  foreach lit in array lits loop
    -- Only the uncast form: running this twice must not produce ::text::text.
    if position(format('changed || %L;', lit) in patched) > 0 then
      patched := replace(patched, format('changed || %L;', lit), format('changed || %L::text;', lit));
      n := n + 1;
    end if;
  end loop;

  if n = 0 then
    raise notice 'portal_transaction_edit already casts its literals; nothing to do';
    return;
  end if;
  if n <> 8 then
    raise exception 'expected 8 uncast literals, found % - look before patching', n;
  end if;
  execute patched;
  raise notice 'portal_transaction_edit: % literals cast to text', n;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
