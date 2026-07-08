-- ════════════════════════════════════════════════════════════════════
-- VeSon Task System — foundational schema (0001_init)
--
-- Design invariants that make this "never rewrite":
--   • workspace-scoped  → collaboration is a new membership row, not a migration
--   • soft-deleted      → tombstones drive offline sync + undo
--   • uuid PKs          → client-generatable, offline-first, merge-safe
--   • self-referential tasks → subtasks are tasks (infinite nesting, one code path)
--   • append-only activities → feeds AI, audit, and collab presence
--   • polymorphic attachments + integration_links → new providers are new rows
--   • recurrence/source/metadata as data → new behaviours without schema churn
-- ════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ── Enums ─────────────────────────────────────────────────────────────
create type workspace_role      as enum ('owner','admin','member','viewer');
create type project_status      as enum ('active','paused','completed','archived');
create type task_status         as enum ('todo','in_progress','done','canceled');
create type priority            as enum ('none','low','medium','high','urgent');
create type recurrence_freq     as enum ('daily','weekly','monthly','yearly');
create type reminder_channel    as enum ('in_app','push','email');
create type reminder_status     as enum ('scheduled','sent','dismissed','canceled');
create type attachment_kind     as enum ('file','image','link');
create type activity_type       as enum ('created','updated','completed','reopened','deleted','commented','moved');
create type entity_type         as enum ('task','project','area','comment');
create type integration_provider as enum ('google_calendar','apple_calendar','email','ai');
create type task_source         as enum ('manual','quick_add','recurring','email','ai','calendar','import');

-- ── Identity & workspaces ─────────────────────────────────────────────
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email        text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references profiles(id),
  is_personal boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  role         workspace_role not null default 'member',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ── Areas (permanent life domains) & Projects (finite efforts) ────────
create table areas (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  color        text,
  icon         text,
  position     double precision not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table projects (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  area_id      uuid references areas(id) on delete set null,
  name         text not null,
  outcome      text,          -- "what does done look like?"
  notes        text,
  status       project_status not null default 'active',
  target_date  date,
  position     double precision not null default 0,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- ── Tasks (subtasks = tasks with parent_id; recurrence lives here) ────
create table tasks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  parent_id       uuid references tasks(id) on delete cascade,       -- subtask link
  project_id      uuid references projects(id) on delete set null,
  area_id         uuid references areas(id) on delete set null,
  title           text not null,
  notes           text,                                              -- markdown
  status          task_status not null default 'todo',
  priority        priority not null default 'none',
  do_date         date,       -- when I plan to work on it  → Today / Upcoming
  due_date        date,       -- hard deadline              → Overdue / urgency
  do_time         time,       -- optional time-of-day for do_date
  position        double precision not null default 0,               -- manual sort
  assignee_id     uuid references profiles(id),                      -- collab seam
  source          task_source not null default 'manual',
  source_metadata jsonb not null default '{}'::jsonb,                -- email/ai/calendar origin
  series_id       uuid,                                              -- groups a recurring series
  recurrence      jsonb,                                             -- {freq,interval,byday[],until,count}
  completed_at    timestamptz,
  metadata        jsonb not null default '{}'::jsonb,                -- escape hatch (ai cache…)
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index tasks_workspace_active_idx on tasks (workspace_id) where deleted_at is null;
create index tasks_project_idx  on tasks (project_id);
create index tasks_parent_idx   on tasks (parent_id);
create index tasks_do_date_idx  on tasks (do_date);
create index tasks_due_date_idx on tasks (due_date);
create index tasks_status_idx   on tasks (status);
create index tasks_series_idx   on tasks (series_id);

-- ── Tags (cross-cutting, many-to-many) ───────────────────────────────
create table tags (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  color        text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);
create table task_tags (
  task_id uuid not null references tasks(id) on delete cascade,
  tag_id  uuid not null references tags(id) on delete cascade,
  primary key (task_id, tag_id)
);

-- ── Attachments (polymorphic: task | project | comment) ──────────────
create table attachments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  parent_type  entity_type not null,
  parent_id    uuid not null,
  kind         attachment_kind not null default 'file',
  name         text not null,
  url          text,           -- external link, OR
  storage_path text,           -- supabase storage object path
  mime_type    text,
  size_bytes   bigint,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index attachments_parent_idx on attachments (parent_type, parent_id);

-- ── Reminders (future push/email; multiple per task) ─────────────────
create table reminders (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  task_id      uuid not null references tasks(id) on delete cascade,
  remind_at    timestamptz not null,
  channel      reminder_channel not null default 'in_app',
  status       reminder_status not null default 'scheduled',
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index reminders_due_idx on reminders (remind_at) where status = 'scheduled';

-- ── Comments (collaboration seam) ────────────────────────────────────
create table comments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  task_id      uuid references tasks(id) on delete cascade,
  project_id   uuid references projects(id) on delete cascade,
  author_id    uuid references profiles(id),
  body         text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- ── Activities (append-only: AI context + audit + collab feed) ───────
create table activities (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id     uuid references profiles(id),
  entity_type  entity_type not null,
  entity_id    uuid not null,
  type         activity_type not null,
  changes      jsonb not null default '{}'::jsonb,   -- { field: [old, new] }
  created_at   timestamptz not null default now()
);
create index activities_feed_idx   on activities (workspace_id, created_at desc);
create index activities_entity_idx on activities (entity_type, entity_id);

-- ── Integration links (calendar two-way + email intake mapping) ──────
create table integration_links (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  provider       integration_provider not null,
  entity_type    entity_type not null,
  entity_id      uuid not null,
  external_id    text not null,     -- gcal event id / email message id
  external_url   text,
  sync_token     text,              -- provider incremental sync cursor
  last_synced_at timestamptz,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (provider, external_id)
);
create index integration_links_entity_idx on integration_links (entity_type, entity_id);

-- ── updated_at trigger ───────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['profiles','workspaces','areas','projects','tasks','comments']
  loop
    execute format(
      'create trigger t_%1$s_updated before update on %1$s
         for each row execute function set_updated_at();', t);
  end loop;
end $$;

-- ── Row Level Security ───────────────────────────────────────────────
create or replace function is_workspace_member(ws uuid) returns boolean as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$ language sql stable security definer;

-- workspaces / members gate on ownership + membership
alter table workspaces        enable row level security;
alter table workspace_members enable row level security;
create policy ws_member_read   on workspaces        for select using (is_workspace_member(id));
create policy ws_owner_write   on workspaces        for all    using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy wsm_self_read    on workspace_members for select using (user_id = auth.uid() or is_workspace_member(workspace_id));

-- every workspace-scoped table shares one membership policy
do $$
declare t text;
begin
  foreach t in array array[
    'areas','projects','tasks','tags','task_tags','attachments',
    'reminders','comments','activities','integration_links'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    -- task_tags has no workspace_id column; gate via its task
    if t = 'task_tags' then
      execute '
        create policy tt_rw on task_tags for all
          using (exists (select 1 from tasks x
                         where x.id = task_tags.task_id
                           and is_workspace_member(x.workspace_id)))
          with check (exists (select 1 from tasks x
                              where x.id = task_tags.task_id
                                and is_workspace_member(x.workspace_id)))';
    else
      execute format(
        'create policy %1$s_rw on %1$s for all
           using (is_workspace_member(workspace_id))
           with check (is_workspace_member(workspace_id));', t);
    end if;
  end loop;
end $$;

-- profiles: a user reads/writes only their own row
alter table profiles enable row level security;
create policy profiles_self on profiles for all using (id = auth.uid()) with check (id = auth.uid());
