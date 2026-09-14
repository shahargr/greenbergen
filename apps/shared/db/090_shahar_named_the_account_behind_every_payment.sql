-- 090 - Shahar named the account behind every payment.
--
-- Migrations 087-089 built money_accounts and backfilled the 2026 rows from
-- the payment method text ("Credit card (W55)", "Paid by Shahar"). That left
-- 87 rows with no source at all: the whole 254 Concord ledger from 2015-16,
-- where the only clue was "SG" in a spreadsheet column, and the ILS loan
-- repayment to Adi and Ruti Greenberg.
--
-- Rather than keep guessing, Shahar went through all 173 rows by hand on
-- 2026-09-14 and said which account each payment left. This writes that down.
-- His answers agreed with 170 of the 173 already on file; the three he moved
-- are called out below.
--
-- Also here, at his instruction: the 17 Concord rows that came out of the
-- spreadsheet with no date at all have been reading as 2026 everywhere,
-- because every screen falls back to created_at when paid_on is null - which
-- put 2016 kitchen cabinets on top of this month's framing payments. They get
-- 2015-08-01, a date inside the job.
--
-- THREE GUARDS ARE STOOD DOWN for the length of this transaction. All three
-- exist to police live work, and this is bookkeeping on finished work:
--
--   trg_lock_completed_transactions - 254 Concord is a Closed project and
--     fn_block_completed_project_writes refuses every write to it. The guard
--     stops anyone re-opening a finished job through the back door; correcting
--     the books of a closed job is the exception it cannot express.
--
--   chk_transactions_payment_complete - demands that any row with an amount
--     also carry paid_on, a payment method, and either a contract or a
--     project+contractor pair. 86 settled Concord rows fail it: they were
--     migrated from a spreadsheet that never named a contractor. The
--     constraint is already NOT VALID, so those rows were never checked when
--     they landed - but any UPDATE re-checks the row it touches, which makes
--     the whole Concord ledger unwritable. It is dropped and re-added exactly
--     as it was, NOT VALID included, so the rules afterwards are unchanged.
--     THIS IS NOT THE FIX. The real fix is still parked and still needs
--     Shahar's word: a requires_payment_detail flag on transaction_statuses
--     plus a BEFORE trigger, so "settled" historical records are held to a
--     record's standard and live payments to a payment's.
--
--   (trg_transactions_notify_upd fires only on a status change, and nothing
--    here touches status, so it stays armed.)
--
-- trg_transactions_direction stays armed ON PURPOSE - it reads the two account
-- columns and sets `direction` itself, which is the whole point: after this
-- migration direction is a computed consequence of the accounts, not a field
-- anybody types.

alter table public.transactions disable trigger trg_lock_completed_transactions;
alter table public.transactions drop constraint chk_transactions_payment_complete;

-- The 17 undated Concord rows. Nothing else on the job is undated, and no
-- Concord row carries a real 2026 date, so this is the whole set.
update public.transactions t
   set paid_on = date '2015-08-01'
  from public.projects p
 where p.id = t.project_id
   and p.project_name = '254 Concord'
   and t.paid_on is null;

-- Shahar personal (ca1b3804) - 89 rows.
-- The entire 254 Concord ledger (2015-16, years before any entity existed),
-- plus the 55 Walnut appraisal fee and topo survey he fronted himself, plus
-- the loan repayment to Adi and Ruti Greenberg - which he moved off "unknown"
-- and onto Personal.
update public.transactions set source_account_id = 'ca1b3804-6db3-46e1-a0f7-7e9a6ea09b42'::uuid
  where left(id::text,8) in (
    '14374738','16408957','23648138','63055953','73910725','017f1a52','01f16325','08b0f0eb','0e5a5592',
    '108abd77','10b5d9c7','12ab6157','18f71b76','1bc81202','1dc19587','1e1cff6b','1e5e1954','208bdff3',
    '23dd02d3','25609e48','29ee7cd6','2a24cf2e','338201a2','372b03d5','379e35ee','389c5f4f','3913a797',
    '3b923e69','3f8551c5','42fabe35','44443c28','46e7503c','4cac78f9','532ca18e','561fe0df','567381fd',
    '6010ca7a','63ac4dcc','67adc876','67e9bc01','6940978c','6d4ef0e6','6fc3c28e','7013b574','78cd8bd7',
    '7f3ccbe1','81027fdf','83a60955','874d03f7','8a3592d1','8cb77139','8e7de1ed','9350b80a','9571e1ab',
    '983f3c0d','9a201958','a2e1d49d','a38642ec','a40090f0','a722b486','ac838301','ace5ca27','ae2c8cf7',
    'b481ff78','ba39a313','bc658971','bc7286b7','c542d996','c7c8e0e4','c90f9eea','cc263444','cc9eba2d',
    'd3a0bb48','d5863d4d','dc001a7a','e46b9290','e52d0d2f','e6b3fb1c','e9da6179','ead69d40','eb2f766d',
    'efc1f393','f017bfa9','f18c83fd','f2e93453','f4637378','f4f08664','f6de315e','facc4b1b'
  );

-- 55 Walnut Drive (bccb397d) - 82 rows. The whole New build job.
-- One row he moved here from Personal: the $202 temp electric permit, which
-- was logged "Paid by Shahar" but belongs to the house.
update public.transactions set source_account_id = 'bccb397d-06ae-4189-b9b6-9c2aebdcbfcc'::uuid
  where left(id::text,8) in (
    '43625750','82808322','024a2f06','06a50c6a','08c18cab','0aad5a0c','0db85c23','0f55ef32','0f6b05da',
    '11ab0716','120aa64d','12bd1f6c','135d4798','16f70275','18b0932d','1cdfc4c5','1e96e599','2282ede3',
    '257ea865','26fdbbdd','2c9be2fa','31fd5e50','38d6b902','42ee90f4','47512f0d','4ba9dae9','4f5a9817',
    '566dd61f','58fcdbc4','5934402b','5f47b034','610270a9','6fb7dbbd','78ba4eb2','7b06f9f5','7d5de83f',
    '886d651f','88c67d2f','8e02a7fa','92278b15','97a502c3','97c33df6','9a4f6bfb','9c0d94b6','9e34918f',
    'a09ec542','a61815ce','a6decc95','a89dbe94','a9a6f016','aa21a0c0','b3ef3e00','b654117d','baeadbcd',
    'be2fc216','bfe97955','c6213ab5','c6c02968','c84e9505','c8ebf964','cd17fad2','cd4bd99d','d217e894',
    'dc3fff0a','de1cc94b','dfacd9d5','e046adab','e6518452','e752ce9f','e8ee702e','e8f2e2ba','eaf34c63',
    'ee8fe91f','eebb067e','f1896f74','f6195c4f','f78721f8','f8167bae','f8f3f5ec','fc807b06','fd355bfc',
    'fdb77248'
  );

-- Net Positive LLC card (06c0d2db) - 1 row: the Optimum internet bill.
update public.transactions set source_account_id = '06c0d2db-7c00-4c4d-bbe0-c4ec169e7c0b'::uuid
  where left(id::text,8) = '021dca28';

-- The 173rd row is the one that runs the other way: the CSAA rental-insurance
-- refund, money arriving at 55 Walnut Drive. It already carries
-- destination_account_id and no source, which is how an incoming payment is
-- spelled, so it is left alone.

alter table public.transactions
  add constraint chk_transactions_payment_complete
  check (
    amount is null
    or (paid_on is not null
        and payment_method_id is not null
        and ((project_id is not null and contractor_id is not null)
             or contract_id is not null))
  ) not valid;

alter table public.transactions enable trigger trg_lock_completed_transactions;

-- Nothing may be left unaccounted for. If a row still has neither end, or the
-- Concord ledger still reads as this year, the whole migration rolls back
-- rather than leaving the books half-answered.
do $$
declare n int;
begin
  select count(*) into n from public.transactions
   where source_account_id is null and destination_account_id is null;
  if n > 0 then
    raise exception 'BACKFILL_INCOMPLETE: % transactions still have no account on either end', n;
  end if;

  select count(*) into n from public.transactions where direction is null;
  if n > 0 then
    raise exception 'DIRECTION_NULL: % transactions ended up with no direction', n;
  end if;

  select count(*) into n
    from public.transactions t join public.projects p on p.id = t.project_id
   where p.project_name = '254 Concord'
     and (t.paid_on is null or t.paid_on >= date '2017-01-01');
  if n > 0 then
    raise exception 'CONCORD_DATES: % Concord rows are still undated or dated after the job', n;
  end if;
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
