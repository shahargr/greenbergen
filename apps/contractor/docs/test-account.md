# The test contractor account

A throwaway contractor used to exercise the **approved** state of the app
before real documents exist. It is not a real trade and its licence and
insurance are fabricated.

## Why it exists rather than approving a real person

`insurance_certificates` is not test data. The homeowner app reads it:
`homeowner_booking()` shows a homeowner whether their contractor is
insured, with the carrier, coverage type, limit and expiry. Writing a
made-up certificate onto a real company would show a real neighbour false
coverage — the same class of mistake as leaking an address. So the fake
paperwork lives on a fake company, and the real record stays clean.

## What it is

| | |
|---|---|
| Sign-in email | `shahar.greenberg+testpro@gmail.com` (Gmail plus-addressing — lands in Shahar's inbox) |
| Contact | `ZZ TEST Pro (Green Bergen test account)` |
| Company | `ZZ TEST Plumbing LLC (Green Bergen test account)` |
| Trades | Plumbing, HVAC (on the contact and the company) |
| Licence | `TEST-NJ-PL-000000` |
| Insurance | General liability and workers' comp, `TEST CARRIER - NOT A REAL POLICY`, one year out |
| W-9 | on file, LLC taxed as partnership |
| Application | `approved` |

Every row says TEST in a field a human will read, and the `ZZ` prefix sorts
it to the bottom of any list.

## How the pre-made contact attaches to the login

`contractor_register` calls `link_contact_for_user`, which falls back to
`contact_id_for_app_user` — a **unique** match on `contacts.email_a` /
`email_b`. The contact above carries that email and nothing else does, so
signing up with it links this record instead of making a second one.
Ambiguity returns null on purpose there, so never give two contacts the
same address.

## One consequence to know about

The moment this contact has a login, it becomes a **real bidder**.
`homeowner_post_internal` invites every contact that has a trade role
matching the package's trade *and* an active `app_users` row. So a genuine
homeowner booking a water heater will have this test account among the
contractors it is offered to, and it will count in their `offered_count`.

That is what makes it useful for testing the feed — and a reason to delete
it before anyone real is relying on the community.

## Deleting it

Run this when testing is done. It removes the certificates, trade roles,
approval, contact and company, and leaves nothing else touched. The auth
user itself is deleted from the Supabase dashboard (Authentication →
Users), which cascades to `app_users`.

```sql
begin;
with ct as (select id, company_id from public.contacts
             where email_a = 'shahar.greenberg+testpro@gmail.com')
delete from public.insurance_certificates ic using ct
 where ic.contractor_id = ct.id or ic.company_id = ct.company_id;

with ct as (select id, company_id from public.contacts
             where email_a = 'shahar.greenberg+testpro@gmail.com')
delete from public.contact_trade_roles r using ct where r.contact_id = ct.id;

with ct as (select id, company_id from public.contacts
             where email_a = 'shahar.greenberg+testpro@gmail.com')
delete from public.company_trade_roles r using ct where r.company_id = ct.company_id;

with ct as (select id from public.contacts
             where email_a = 'shahar.greenberg+testpro@gmail.com')
delete from public.contractor_approvals a using ct where a.contact_id = ct.id;

-- Any app_users row pointing at the contact has to let go first.
with ct as (select id from public.contacts
             where email_a = 'shahar.greenberg+testpro@gmail.com')
update public.app_users u set contact_id = null from ct where u.contact_id = ct.id;

with ct as (select id, company_id from public.contacts
             where email_a = 'shahar.greenberg+testpro@gmail.com')
delete from public.contacts c using ct where c.id = ct.id;

delete from public.companies
 where company_name = 'ZZ TEST Plumbing LLC (Green Bergen test account)';
commit;
```

Check first that the test account holds no bids or contracts — if it
accepted a job during testing, unwind that job before deleting the
contractor behind it:

```sql
select b.id, b.status, b.project_id from public.bids b
 join public.contacts c on c.id = b.bidder_contact_id
 where c.email_a = 'shahar.greenberg+testpro@gmail.com';
```
