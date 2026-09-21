-- A FILE BELONGS TO THE PROJECT IT WAS UPLOADED INTO, AND TO EVERY PROJECT IT
-- HAS SINCE BEEN ASSIGNED TO.
--
-- Shahar, 2026-09-20: "if somebody uploads a file into a project, it should be
-- available to the project... It cannot be available to everything. But if
-- somebody is uploading a file on the higher level, then in theory, if you're
-- an admin, you can assign it to other projects as well."
--
-- The first half already worked. The second half was half-built, and the
-- half-built state was worse than nothing:
--
--   file_links can already point a file at a second project, and
--   file_link_read lets that project's members READ THE LINK - but
--   can_see_file only ever looked at files.project_id, the single column on
--   the file row, and never at the links.
--
-- Measured, not assumed. Linking a file to a second project and asking as an
-- ordinary member of that project: is_project_member true, links readable 1,
-- can_see_file FALSE, rows visible in files 0. So assigning a file produced a
-- dangling attachment - the second project's people could see that something
-- was attached and could not open it.
--
-- The fix is to ask the question of EVERY project the file belongs to rather
-- than of one column: its home project, plus each project its links resolve
-- to. The contract-bounded rule is unchanged and now applies per project, so
-- a member bounded to one contract still only sees what that contract touches.
--
-- SAFE ON EVERY EXISTING ROW, and that was checked before writing it. Of 99
-- links: 74 point at the file's own home project, 0 point at a different
-- project, 24 resolve to no project at all (bids, transactions, check-ins and
-- comments, which file_link_project_id does not resolve - deliberately left
-- alone, since resolving them WOULD widen visibility). So no file changes
-- hands. The single exception is one document, "BDR job description v2",
-- which has no home project and is linked into CloudHiro GTM: today only a
-- superadmin can open it, and after this its project's members can, which is
-- the whole point of the feature.
create or replace function public.can_see_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_superadmin() or exists (
    select 1
      from public.files f
      -- Every project this file belongs to. LATERAL so it can read f.
      cross join lateral (
        select f.project_id as pid
        union
        select public.file_link_project_id(fl.*)
          from public.file_links fl
         where fl.file_id = f.id
      ) p
     where f.id = p_file_id
       and p.pid is not null
       and public.is_project_member(p.pid)
       and (not public.is_contract_bounded_member(p.pid)
            or exists (
              select 1 from public.file_links fl
               where fl.file_id = f.id
                 and (fl.contract_id in (select contract_id from public.my_contract_ids(p.pid))
                   or (fl.action_id is not null and public.can_see_action(fl.action_id))
                   or fl.project_scope_item_id in (
                        select s.id from public.project_scope_items s
                         where s.contract_id in (select contract_id from public.my_contract_ids(p.pid)))
                   or fl.payment_stage_id in (
                        select ps.id from public.payment_stages ps
                         where ps.contract_id in (select contract_id from public.my_contract_ids(p.pid)))))))
$$;

comment on function public.can_see_file(uuid) is
  'True when the caller is a superadmin, or a member of ANY project the file belongs to - the project it was uploaded into, or any project it has been assigned to through file_links - subject to the contract-bounded rule for that project.';
