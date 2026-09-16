-- 147 + 148. A SIGNED CONTRACT IS NOT "NOT STARTED",
--            AND FUZZY MATCHING IS A FALLBACK, NOT A RULE.
--
-- Shahar (2026-09-16), on the spine on 55 Walnut: "why am I unable to enter
-- demo panel, and log the work on it... if you are waiting on the business to
-- be awarded, let's open a wizard to award the business in cases we did a
-- shortcut and pre-selected a contractor. in this case for example, you
-- already have a contract with Marcel Blanco I believe."
--
-- He was right that there was a contract, and the board was lying about it.
-- Demo & Excavation is covered by a SIGNED contract - "Demo/Excavation +
-- Landscape/Hardscape - GB The Landscapers" - and a second AWARDED one for the
-- sump pit. The tile said "not started".
--
-- TWO FAULTS.
--
-- ONE: the match was spelt, not meant. portal_project_trades joined contracts
-- to trades on lower(c.trade) = lower(t.trade), and a contract's trade is free
-- text a person typed. Four of the twenty-one strings on this property match
-- nothing in the catalogue - "demolition / excavation / landscaping",
-- "excavation", "windows", "asbestos abatement" - and two of those four are
-- the most real contracts on the job.
--
-- TWO: "no open tasks" was being read as "nobody has started". Those are
-- different facts needing different answers. A trade with a signed contract
-- and nothing open has been APPOINTED and the work is not logged yet.
--
-- AND THE MISTAKE I MADE FIXING IT, which is the part worth keeping. The first
-- cut matched any shared five-letter word between a contract's trade and a
-- catalogue trade, and I tested it only against the four strings that matched
-- NOTHING. Against the seventeen that already matched exactly it is a
-- disaster: "Waste Removal" and "Snow Removal" share "removal", so the waste
-- contract appointed a snow contractor; nine Supply: trades share "supply", so
-- one lumber contract appointed all of them; "Supply: General" fed "General
-- Contractor". The board went from 24 trades to 34, ten of them fiction.
--
-- The rule was never "two trades with a word in common are the same trade". It
-- is "when somebody typed a trade we do not recognise, work out what they
-- meant". A contract that says "Supply: General" is not ambiguous and must not
-- be guessed at. So the fallback applies ONLY to strings that match no
-- catalogue trade exactly - which is what covers does below, and what the
-- comment on trade_matches now warns about.
--
-- After: 26 trades. The two added are Asbestos and Supply: Windows, which have
-- real contracts that were invisible; Snow Removal and the phantom Supply
-- trades are gone; Tree Removal is Pamela again rather than the waste company.
create or replace function public.trade_matches(p_contract_trade text, p_trade text)
returns boolean
language sql
immutable
as $function$
  select p_contract_trade is not null and p_trade is not null
     and (lower(btrim(p_contract_trade)) = lower(btrim(p_trade))
          or exists (
            select 1 from (
              select unnest(regexp_split_to_array(lower(p_contract_trade), '[^a-z]+')) w
              intersect
              select unnest(regexp_split_to_array(lower(p_trade), '[^a-z]+')) w) s
             where length(s.w) >= 5));
$function$;

comment on function public.trade_matches(text, text) is
'Whether an UNRECOGNISED contract trade string covers a catalogue trade: a shared word of five letters or more. It is a fallback for free text nobody could match, never a general similarity test - "Waste Removal" and "Snow Removal" share a word and are not the same trade, which is why callers must apply it only when the contract names no catalogue trade exactly (migration 148).';

-- portal_project_trades is replaced in full by the migration applied as
-- "fuzzy_matching_is_a_fallback_not_a_rule"; its shape is:
--
--   fam     every contract on the family, flagged is_known when its trade
--           names a catalogue trade exactly
--   covers  a known contract means THAT trade and only that one; an unknown
--           one gets trade_matches and the benefit of the doubt
--   appointed  per trade, whether any covering contract is signed/awarded
--   state   appointed when nothing is open but a contract covers it,
--           idle when nothing is open and nothing does,
--           working / hiring / loose as before
--
-- See the live definition; it is too long to duplicate here and duplicating it
-- is how the two copies drift.
