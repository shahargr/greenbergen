-- A LIBRARY FILING IS A LEGAL ROLE.
--
-- Shahar, 2026-09-24, dropping the signed contract onto a library shelf:
-- 'new row for relation "file_links" violates check constraint
-- "file_links_role_check"'. Migration 228's portal_library_file writes
-- role='library', but the role vocabulary predates the library and never
-- learned the word. The upload itself succeeded - bytes, files row - so
-- the file landed in "Everything else" instead of the folder, and a second
-- try made a second copy (its own action: block duplicate uploads).
--
-- The fix is one word in the CHECK.
alter table public.file_links drop constraint file_links_role_check;
alter table public.file_links add constraint file_links_role_check
  check (role = any (array['before', 'after', 'evidence', 'progress', 'invoice',
                           'drawing', 'reference', 'design', 'marketing',
                           'bid_package', 'bid_reply', 'library']));
