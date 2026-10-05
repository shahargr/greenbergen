# Handoff and recovery - the script (Shahar 2026-10-05)

Two commands. "handoff" ends a chat. "recovery" runs in one fresh chat and
gathers every handoff into main. State lives in `public.actions` and in git
branches, never in a shared file: a shared `docs/handoff.md` was a merge
conflict waiting in every branch, so it is frozen as history.

Cost rules for both: name columns, bound every query (rulebook 06), combine
independent reads into one call, run independent shell commands in parallel,
never re-read what the conversation already holds, read a file range not the
whole file, and write facts not narrative.

## HANDOFF - the chat that did the work

1. **Branch.** Commit on your own `claude/*` branch and push that branch
   only. Never merge to main, never push main. A branch push builds nothing.
2. **Migration numbers.** Before naming a migration, list the numbers taken
   on main AND on every unmerged branch
   (`git branch -r --no-merged origin/main`, then `git ls-tree -r --name-only
   <branch> apps/shared/db | tail`) and take the next free one. Two chats
   both took 245 on 2026-10-05.
3. **Checks.** Run typecheck and lint only for the apps your diff touches
   (`git diff --name-only origin/main...HEAD` shows which); docs-only or
   data-only work runs none and says so.
4. **One handoff row.** Insert minimal, then fill the notes with an UPDATE
   (rulebook 04: long inserts fail silently):
   `action` = `Session handoff YYYY-MM-DD: <topic>`, `status` = `Not Started`,
   `domain` = `system`. Notes, at most ~1500 characters, in this fixed order:
   - `BRANCH <name> - <READY TO MERGE | UNFINISHED | ALREADY MERGED | NO CODE>`, head commit, commits not on main
   - `CHECKS` what ran and the result
   - `MIGRATIONS` number, name, applied or NOT applied, file path; or none
   - `DATA` writes made with no migration file
   - `DECISIONS` by Shahar, one line each
   - `DRIFT` where rulebook, help or memory disagrees with live
   - `LEFT UNDONE` and why
5. **Children, not a list in the notes.** Every follow-up is its own row with
   `parent_action_id` = the handoff row. Search `actions` first (rule 30) so
   a task is never created twice.
6. Tell Shahar the branch, its status and the row id in three lines.

## RECOVERY - the one chat that merges

1. **One read.** Bootstrap, handoffs and their open children in a single
   call (children trimmed to 200 characters of notes):
   ```sql
   select 'rule' k, section_key key, title, case when section_key < '10' then body end body from public.rulebook
   union all select 'help', topic, title, doc_type from public.help
   union all select 'handoff', id::text, action, notes from public.actions
     where action like 'Session handoff%' and status = 'Not Started'
   union all select 'child', parent_action_id::text, action || ' | ' || status || ' | ' || coalesce(priority,''), left(coalesce(notes,''),200)
     from public.actions where status not in ('Completed','Cancelled')
       and parent_action_id in (select id from public.actions where action like 'Session handoff%' and status = 'Not Started')
   order by 1, 2;
   ```
   (Rulebook bodies 00-08 only; the rest loads on demand, rulebook 01.)
2. **Branches.** In parallel with step 1: `git fetch origin`,
   `git branch -r --no-merged origin/main`, and per branch
   `git log --oneline origin/main..<branch>`. Match each branch to a handoff.
   A branch with no handoff, or a handoff naming a missing branch, is
   flagged, not merged.
3. **Merge once.** Local `main` from `origin/main`. Merge each READY TO MERGE
   branch with `--no-ff`, one at a time, smallest first. Conflicts: if both
   sides only add, keep both; otherwise stop and ask. UNFINISHED branches
   stay unmerged. Check overlap before merging:
   `comm -12` of the two branches' `git diff --name-only origin/main...<b>`.
4. **Checks, scoped.** After the merges run typecheck and lint once, in
   parallel, only for the apps the merged diff touched (root, `apps/homeowner`,
   `apps/contractor`). Skip `npm install` when `node_modules` exists.
5. **Show Shahar the result and wait.** Push main once, only on his go.
   Today every `vercel.json` sets `main` to `false`, so a push builds
   nothing and deploying is a separate command (CLAUDE.md); rulebook 08 still
   describes the old behaviour until its body is rewritten.
6. **Migrations - list, never apply.** Do not call `list_migrations` (about
   60 KB). Read the tail and compare with the files:
   `select version, name from supabase_migrations.schema_migrations order by version desc limit 12;`
   against `ls apps/shared/db` on main and every branch. Report each
   unapplied one with what depends on it, and any number used twice.
   Apply nothing without Shahar's go.
7. **One ranked list.** All open children plus anything flagged: duplicates
   merged, blockers first, unfinished branches named, each child under its
   real parent (update `parent_action_id`).
8. **Close handoff rows** with `close_action` only once their content is
   absorbed into the list and the merged state. Never close one whose branch
   is unmerged.
9. Ask Shahar what to do first, in the `DECIDE:` format of CLAUDE.md. Keep
   every answer short.
