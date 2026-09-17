-- 181: A BID IS THE FIRM'S BID, AND THE PERSON'S NAME IS HIS NAME.
--
-- Shahar (2026-09-17) settled it: the bidder is the COMPANY, with a person
-- named. The room writes both halves from the day it opened, but the bids
-- that predate it carry only a contact - so the comparison headed a column
-- "Luis Bermudez (Nir) HVAC - NJ Service Provider" instead of "FUSION
-- HEATING AND COOLING · Luis Bermudez". That string is a log import's idea
-- of a name, not something anybody would say out loud.
--
-- Two repairs, both narrow. Every bid whose contact belongs to a firm gets
-- that firm on the bid. And the three HVAC people get their own names back;
-- the trade and the state they are in are already recorded elsewhere, so
-- carrying them in the name only makes the column unreadable.

update public.bids b
   set bidder_company_id = ct.company_id,
       last_modified_at = now(), last_modified_by = 'migration:181'
  from public.contacts ct
 where ct.id = b.bidder_contact_id
   and b.bidder_company_id is null
   and ct.company_id is not null;

update public.contacts set person_name = 'Luis Bermudez', last_modified_at = now(), last_modified_by = 'migration:181'
 where id = '5c110f2a-01dd-4d6e-8765-68e674ea3ba5';
update public.contacts set person_name = 'Estuardo', last_modified_at = now(), last_modified_by = 'migration:181'
 where id = '127ac312-edaf-47fa-853d-dcd8853adca6';
update public.contacts set person_name = 'Jacob', last_modified_at = now(), last_modified_by = 'migration:181'
 where id = '70b3a035-e765-41ad-a984-fbd8649b641b';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
