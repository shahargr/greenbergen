-- 084  A RECEIPT BELONGS TO THE PAYMENT IT PAID
--
-- Shahar (2026-09-13), on the payment drawer inside a task: "when logging a
-- payment. i need a way to edit it and add photos into it. right now i
-- cannot."
--
-- He could not, and the reason turned out to be a live bug rather than a
-- missing button.
--
-- file_links is the table that says what a file is ABOUT, and it carries a
-- column for every one of them - action_id, action_comment_id, contract_id,
-- bid_id, bid_package_id, payment_stage_id, project_scope_item_id,
-- project_space_id, site_checkin_id, project_id - and no transaction_id. So a
-- receipt could not be filed against a payment at all: three payments on one
-- task ($12,438, $8,315, $14,677) shared one undifferentiated pile of paper
-- with nothing recording which receipt paid which.
--
-- THE BUG UNDERNEATH IT. chk_file_links_one_target requires EXACTLY ONE
-- target, and task_payment_log's receipt path inserted action_id AND
-- project_id - two. So every attempt to attach a receipt while logging a
-- payment raised a constraint violation and rolled the whole payment back
-- with it. Zero of the 67 rows in file_links carry both, which is the proof
-- it never once succeeded since migration 065 wrote it. That is exactly the
-- "right now i cannot" being reported.
--
-- Four things, and the order matters: the column, the widened invariant, the
-- write paths corrected to one target, and the close gate taught to walk the
-- new relationship so that filing paperwork CORRECTLY cannot stop a task
-- closing.
--
-- WHAT IS NOT DONE HERE: the receipts already filed against a task stay on
-- the task. Which of three payments each one belongs to is not recoverable
-- from the data, and a guess would be a wrong answer wearing a confident
-- face. Anything filed from now on lands on its payment.

-- ---------------------------------------------------------------------------
-- 1. THE COLUMN.
alter table public.file_links
  add column if not exists transaction_id uuid references public.transactions(id) on delete cascade;
create index if not exists idx_file_links_transaction
  on public.file_links (transaction_id) where transaction_id is not null;

comment on column public.file_links.transaction_id is
  'The payment this file is the receipt for. Added 2026-09-13: every other thing a file can be about had a column here and a transaction did not, so receipts piled up on the task instead.';

-- ---------------------------------------------------------------------------
-- 2. THE INVARIANT, widened to eleven and still exactly one. This is the
--    constraint that caught the bug; it keeps its teeth.
alter table public.file_links drop constraint if exists chk_file_links_one_target;
alter table public.file_links add constraint chk_file_links_one_target check (
  (case when action_id is null then 0 else 1 end)
+ (case when action_comment_id is null then 0 else 1 end)
+ (case when transaction_id is null then 0 else 1 end)
+ (case when payment_stage_id is null then 0 else 1 end)
+ (case when project_id is null then 0 else 1 end)
+ (case when contract_id is null then 0 else 1 end)
+ (case when project_space_id is null then 0 else 1 end)
+ (case when project_scope_item_id is null then 0 else 1 end)
+ (case when site_checkin_id is null then 0 else 1 end)
+ (case when bid_package_id is null then 0 else 1 end)
+ (case when bid_id is null then 0 else 1 end) = 1);

-- ---------------------------------------------------------------------------
-- 3a. ATTACH AND DETACH, on a payment that already exists.
--
-- Its own function rather than more keys on portal_transaction_edit:
-- attaching a photo is not editing a field, and the edit form must not have
-- to resend the whole file list every time somebody corrects a reference.
create or replace function public.portal_transaction_files(
  p_id uuid, p_add uuid[] default null, p_remove uuid[] default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id();
  t public.transactions; f uuid; n_add int := 0; n_rm int := 0;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;
  select * into t from public.transactions where id = p_id;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'No such payment.'); end if;
  if t.project_id is null then
    return jsonb_build_object('ok', false, 'reason', 'That payment is not on a project.');
  end if;
  if not public.fin_may_record(t.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Money on this project is not yours to change.');
  end if;

  if p_add is not null then
    foreach f in array p_add loop
      -- This runs as definer, so a file id arriving from a form is checked
      -- against the project before anything is linked to it.
      if not exists (select 1 from public.files x where x.id = f and x.project_id = t.project_id) then
        return jsonb_build_object('ok', false, 'reason', 'One of those files does not belong to this project.');
      end if;
      delete from public.file_links where file_id = f;
      insert into public.file_links (file_id, transaction_id, role, created_by_user_id)
      values (f, t.id,
              case when (select kind from public.files where id = f) = 'photo' then 'evidence' else 'invoice' end,
              me);
      n_add := n_add + 1;
    end loop;
  end if;

  if p_remove is not null then
    foreach f in array p_remove loop
      -- Only unlinks it from THIS payment. The file stays in the project's
      -- folder: somebody uploaded a real document, and taking it off a row is
      -- not a reason to destroy it.
      delete from public.file_links where file_id = f and transaction_id = t.id;
      if found then n_rm := n_rm + 1; end if;
    end loop;
  end if;

  if n_add > 0 or n_rm > 0 then
    update public.transactions set last_modified_by = 'portal', last_modified_at = now() where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'added', n_add, 'removed', n_rm);
end $function$;

comment on function public.portal_transaction_files(uuid, uuid[], uuid[]) is
  'Attach or detach receipts on an existing payment. Removing unlinks; the file stays in the project folder.';

revoke all on function public.portal_transaction_files(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.portal_transaction_files(uuid, uuid[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. THE BUG, fixed at its source. Patched in place rather than restated:
--     task_payment_log is 120 lines of rules about methods, payees and
--     awaiting-confirmation tasks, and copying all of it to change one insert
--     is how two versions of a function drift apart. v_id is the transaction,
--     inserted above the file loop, so it is already in hand.
do $patch$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'task_payment_log';
  if src is null then raise exception 'task_payment_log not found'; end if;
  if position('(file_id, transaction_id, role, created_by_user_id)' in src) > 0 then
    raise notice 'task_payment_log already files against the transaction'; return;
  end if;
  patched := replace(src,
    'insert into public.file_links (file_id, action_id, project_id, role, created_by_user_id)
      values (f, a.id, a.project_id,',
    'insert into public.file_links (file_id, transaction_id, role, created_by_user_id)
      values (f, v_id,');
  if patched = src then raise exception 'task_payment_log file insert not found - patch by hand'; end if;
  execute patched;
end $patch$;

-- ---------------------------------------------------------------------------
-- 4a. A PAYMENT ROW CARRIES ITS OWN RECEIPTS, so the drawer can show them and
--     the collapsed row can say how many are actually on file - which is a
--     different fact from the status somebody chose.
do $patch$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_detail';
  if src is null then raise exception 'portal_task_detail not found'; end if;
  if position('fl2.transaction_id = t.id' in src) > 0 then
    raise notice 'payments already carry their files'; return;
  end if;
  patched := replace(src,
    '''contract_id'', t.contract_id)',
    '''contract_id'', t.contract_id,
                 ''files'', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            ''file_id'', f2.id, ''name'', f2.file_name, ''kind'', f2.kind,
                            ''bucket'', f2.bucket, ''path'', f2.path)
                          order by f2.created_at)
                     from public.file_links fl2
                     join public.files f2 on f2.id = fl2.file_id
                    where fl2.transaction_id = t.id), ''[]''::jsonb))');
  if patched = src then
    raise exception 'portal_task_detail payment block not found - patch by hand';
  end if;
  execute patched;
end $patch$;

-- ---------------------------------------------------------------------------
-- 4b. A RECEIPT ON A PAYMENT IS STILL PROOF THE TASK CLOSES ON.
--     It used to count only because it was wrongly linked to the action.
--     Filed correctly it hangs off the transaction, so the gate walks that
--     relationship - otherwise doing the paperwork RIGHT would be the thing
--     that stopped the task closing.
do $patch$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_close_task';
  if src is null then raise exception 'portal_close_task not found'; end if;
  if position('fl.transaction_id in' in src) > 0 then
    raise notice 'portal_close_task already counts receipts on payments'; return;
  end if;
  patched := replace(src,
    'where (fl.action_id = p_action_id
          or fl.action_comment_id in (select c.id from public.action_comments c where c.action_id = p_action_id));',
    'where (fl.action_id = p_action_id
          or fl.action_comment_id in (select c.id from public.action_comments c where c.action_id = p_action_id)
          or fl.transaction_id in (select tx.id from public.transactions tx where tx.action_id = p_action_id));');
  if patched = src then raise exception 'portal_close_task proof count not found - patch by hand'; end if;
  execute patched;
end $patch$;

-- Verified end to end on a real task in a rolled-back probe: attach returns
-- added 1; the file lands on ONE payment of six and not the others; and
-- portal_close_task then reports proof 1 and closes clean without asking for
-- a reason.

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
