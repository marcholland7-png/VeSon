# VeSon Task Core — Architecture

The durable, UI-agnostic foundation for VeSon's task system. The UI (vanilla
JS today, possibly React later) sits *on top* of this. Nothing below the UI
line should ever need a rewrite — new capabilities plug into named seams.

## The layers (each arrow is an interface)

```
        UI  (vanilla js today · React tomorrow)
         │            imports ONLY  createTaskCore()  from  src/core/index.ts
         ▼
   ┌───────────┐   optimistic writes    ┌──────────────┐
   │   Store   │◄───────────────────────│   Services   │  business rules
   │ (reactive)│    selectors derive     │ ITaskService…│  complete / rank / recur
   └───────────┘    today/overdue/pulse  └──────┬───────┘
                                                │ StorageAdapter (interface)
                                    ┌───────────┼────────────┐
                                    ▼           ▼            ▼
                          LocalStorageAdapter  SupabaseAdapter  SyncedAdapter
                             (instant)          (durable)       (offline-first)
                                                                 │
                                                          Supabase / Postgres
                                                          (supabase/migrations)
```

## File map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/0001_init.sql` | **Durable core.** Schema, RLS, triggers. |
| `enums.ts`       | Closed value sets; 1:1 with Postgres enums. |
| `types.ts`       | Entities (mirror rows), DTOs (write inputs), Queries, Views (computed). |
| `interfaces.ts`  | Every contract: `Repository`, `StorageAdapter`, `SyncAdapter`, service interfaces, and **future seams** (`IAIService`, `IReminderService`, `ICalendarSyncService`, `IEmailIntakeService`). |
| `lib.ts`         | `Result`, uuid/date helpers, recurrence expansion, camel⇄snake. |
| `store.ts`       | Reactive store, event bus, decision-surface selectors. |
| `repositories.ts`| Local / Supabase / Synced adapters (one interface, three backends). |
| `services.ts`    | CRUD + rules. `TaskService` is the reference; peers follow it. |
| `index.ts`       | Composition root. The only file the UI imports. `createTaskCore()`. |

## Why you never rewrite it — the required feature set

| Requirement | Where it lives | Rewrite-proof because… |
|---|---|---|
| Projects | `projects` table · `IProjectService` | first-class entity + computed `ProjectView` |
| Tasks | `tasks` table · `ITaskService` | reference CRUD implementation |
| Subtasks | `tasks.parent_id` (self-ref) | a subtask **is** a task — one code path, infinite nesting |
| Tags | `tags` + `task_tags` | many-to-many, workspace-scoped |
| Due dates | `do_date` **and** `due_date` | two distinct dates → correct Today/Overdue |
| Priorities | `priority` enum (ordinal) | `Priority.indexOf()` ranks without a lookup table |
| Notes | `notes` markdown column | present on task + project |
| Attachments | `attachments` (polymorphic) | attach to task/project/comment; file or link |
| Status | `task_status` / `project_status` enums | explicit lifecycle |
| Recurring | `recurrence` jsonb + `series_id` | rule-as-data; `RecurrenceService.advance()` |

## Why you never rewrite it — the future features (seams already defined)

Each is an interface in `interfaces.ts` with a runtime stub in `services.ts`.
Shipping one = writing the implementation and swapping the stub. **No caller changes.**

| Future | Seam | Schema already in place |
|---|---|---|
| AI (quick-add, plan-my-day, next) | `IAIService` | `task_source='ai'`, `metadata`, `activities` feed for context |
| Reminders (push/email) | `IReminderService` | `reminders` table (multi-channel) |
| Collaboration | assignee + roles | `workspaces`, `workspace_members`, `assignee_id`, `comments`, RLS |
| Calendar sync (2-way) | `ICalendarSyncService` | `integration_links` (external id ↔ task), `do_date` |
| Email → task | `IEmailIntakeService` | `task_source='email'`, `integration_links`, `source_metadata` |

## Two decisions baked in

1. **Auth-based, workspace-scoped from day one.** Single user now = one personal
   workspace. Sharing later = insert a `workspace_members` row; RLS already
   enforces the boundary. Collaboration is a policy, not a migration.

   *Migration from today's sync-code model:* create a Supabase Auth user, insert
   a `workspaces` row (`is_personal=true`), backfill existing `sync`/`eitje_data`
   under it, point the anon reads at authenticated reads. The task tables are new,
   so there's nothing to convert — this is additive.

2. **Offline-first, computed-on-read.** The store is the UI's truth; the
   `SyncedAdapter` reconciles with Supabase using newer-`updatedAt`-wins +
   `deletedAt` tombstones — the **same merge protocol as VeSon's calendar**, so
   the two systems behave identically and share mental model.

## Running it

```bash
npm install
npm run typecheck        # validate the contracts
```
```ts
import { createTaskCore } from './src/core';
const core = createTaskCore({ supabaseClient });   // omit → pure offline
await core.bootstrap(workspaceId);
const { value: task } = await core.services.tasks.create({ title: 'Ship VeSon v2', priority: 'high', dueDate: '2026-07-15' });
const briefing = await core.services.ranking.briefing();   // the Today surface
```
The current vanilla UI can consume `createTaskCore()` from compiled output
(`npm run build:core`) today; a future React UI consumes the same API unchanged.
