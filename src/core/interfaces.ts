/**
 * Contracts — the reason this never gets rewritten.
 *
 * The UI talks to Services. Services talk to Repositories. Repositories talk
 * to a storage adapter. Every arrow is an interface, so any layer can be
 * swapped (localStorage → Supabase → realtime), and future capabilities
 * (AI, reminders, calendar, email) plug into named seams that already exist
 * here as interfaces — you implement them later without touching callers.
 */

import type {
  UUID, Task, Project, Area, Tag, Comment, Reminder, Attachment, Activity,
  TaskView, ProjectView, TodayBriefing,
  CreateTaskInput, UpdateTaskInput, CreateProjectInput, UpdateProjectInput,
  CreateAreaInput, UpdateAreaInput, CreateTagInput, CreateReminderInput,
  TaskQuery, RecurrenceRule, AnyEntity, EntityName, ISODate, ISODateTime,
} from './types';

// ── Result: no throwing across layer boundaries ──────────────────────
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };
export interface AppError { code: string; message: string; cause?: unknown; }

// ── Generic repository (the CRUD spine) ──────────────────────────────
export interface Repository<T, TCreate, TUpdate, TQuery = unknown> {
  get(id: UUID): Promise<Result<T | null>>;
  list(query?: TQuery): Promise<Result<T[]>>;
  create(input: TCreate): Promise<Result<T>>;
  update(id: UUID, patch: TUpdate): Promise<Result<T>>;
  remove(id: UUID): Promise<Result<void>>;      // soft delete (sets deletedAt)
  restore(id: UUID): Promise<Result<void>>;
}

// ── Storage adapter: the ONE thing a backend must implement ──────────
// Repositories are backend-agnostic; they compose over this primitive.
export interface StorageAdapter {
  read<T extends AnyEntity>(entity: EntityName, id: UUID): Promise<T | null>;
  query<T extends AnyEntity>(entity: EntityName, q?: unknown): Promise<T[]>;
  write<T extends AnyEntity>(entity: EntityName, row: T): Promise<T>;
  writeMany<T extends AnyEntity>(entity: EntityName, rows: T[]): Promise<T[]>;
  /** Rows changed since a cursor — powers incremental sync. */
  changesSince(entity: EntityName, since: ISODateTime | null): Promise<AnyEntity[]>;
}

// ── Offline-first sync ───────────────────────────────────────────────
export interface SyncAdapter {
  /** Push local pending changes, pull remote, reconcile. */
  sync(entity?: EntityName): Promise<Result<SyncReport>>;
  onRemoteChange(cb: (entity: EntityName, rows: AnyEntity[]) => void): () => void;
  status(): SyncState;
}
export interface SyncReport { pushed: number; pulled: number; conflicts: number; }
export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

// ── Domain services (what the app actually calls) ────────────────────
export interface ITaskService
  extends Repository<Task, CreateTaskInput, UpdateTaskInput, TaskQuery> {
  view(id: UUID): Promise<Result<TaskView | null>>;
  listViews(query?: TaskQuery): Promise<Result<TaskView[]>>;
  complete(id: UUID): Promise<Result<Task>>;
  reopen(id: UUID): Promise<Result<Task>>;
  reschedule(id: UUID, doDate: ISODate | null): Promise<Result<Task>>;
  setPriority(id: UUID, priority: Task['priority']): Promise<Result<Task>>;
  move(id: UUID, to: { projectId?: UUID | null; areaId?: UUID | null }): Promise<Result<Task>>;
  reorder(ids: UUID[]): Promise<Result<void>>;                 // manual drag order
  addSubtask(parentId: UUID, input: CreateTaskInput): Promise<Result<Task>>;
  setTags(id: UUID, tagIds: UUID[]): Promise<Result<void>>;
}

export interface IProjectService
  extends Repository<Project, CreateProjectInput, UpdateProjectInput> {
  view(id: UUID): Promise<Result<ProjectView | null>>;
  listViews(): Promise<Result<ProjectView[]>>;
  archive(id: UUID): Promise<Result<Project>>;
}

export interface IAreaService extends Repository<Area, CreateAreaInput, UpdateAreaInput> {}
export interface ITagService {
  list(): Promise<Result<Tag[]>>;
  ensure(name: string): Promise<Result<Tag>>;   // find-or-create
  remove(id: UUID): Promise<Result<void>>;
}
export interface IAttachmentService {
  listFor(parentType: Attachment['parentType'], parentId: UUID): Promise<Result<Attachment[]>>;
  attachFile(parentType: Attachment['parentType'], parentId: UUID, file: Blob, name: string): Promise<Result<Attachment>>;
  attachLink(parentType: Attachment['parentType'], parentId: UUID, url: string, name: string): Promise<Result<Attachment>>;
  remove(id: UUID): Promise<Result<void>>;
}
export interface IActivityService {
  record(a: Omit<Activity, 'id' | 'createdAt' | 'workspaceId'>): Promise<void>;
  feed(entityId?: UUID, limit?: number): Promise<Result<Activity[]>>;
}

// ── Ranking (the "decide for me" brain) ──────────────────────────────
export interface IRankingService {
  focusScore(task: Task): number;                    // pure, deterministic
  briefing(): Promise<Result<TodayBriefing>>;        // the Today surface
  nextUp(): Promise<Result<TaskView | null>>;
}

// ── Recurrence (data-driven, no schema churn) ────────────────────────
export interface IRecurrenceService {
  expand(rule: RecurrenceRule, from: ISODate, to: ISODate): ISODate[];
  /** On completing a recurring instance, materialize the next one. */
  advance(task: Task): Promise<Result<Task | null>>;
}

// ═════════════════════════════════════════════════════════════════════
// FUTURE SEAMS — interfaces defined now, implemented later.
// Callers depend on these; wiring a real implementation is additive.
// ═════════════════════════════════════════════════════════════════════

export interface IReminderService {                    // → push/email later
  schedule(input: CreateReminderInput): Promise<Result<Reminder>>;
  cancel(id: UUID): Promise<Result<void>>;
  dueBefore(at: ISODateTime): Promise<Result<Reminder[]>>;
}

export interface IAIService {                          // → command bar + planning
  parseQuickAdd(text: string): Promise<Result<CreateTaskInput>>;   // NL → task
  planDay(date: ISODate): Promise<Result<UUID[]>>;                 // suggested Today set
  suggestNext(): Promise<Result<UUID | null>>;
  ask(prompt: string, context: TaskContext): Promise<Result<string>>;
}
export interface TaskContext { tasks: TaskView[]; projects: ProjectView[]; briefing: TodayBriefing; }

export interface ICalendarSyncService {                // → Google/Apple two-way
  pushTask(taskId: UUID): Promise<Result<void>>;       // do_date → calendar block
  pull(): Promise<Result<SyncReport>>;                 // events → tasks
  link(taskId: UUID, externalId: string): Promise<Result<void>>;
}

export interface IEmailIntakeService {                 // → email-to-task
  ingest(message: EmailMessage): Promise<Result<Task>>;
}
export interface EmailMessage { id: string; from: string; subject: string; body: string; receivedAt: ISODateTime; }

// ── Reactive store ───────────────────────────────────────────────────
export type Unsubscribe = () => void;
export interface Store<S> {
  getState(): S;
  setState(patch: Partial<S> | ((s: S) => Partial<S>)): void;
  subscribe(listener: (s: S) => void): Unsubscribe;
  select<R>(selector: (s: S) => R, listener: (r: R) => void): Unsubscribe;
}
export interface EventBus {
  emit<T = unknown>(type: string, payload?: T): void;
  on<T = unknown>(type: string, handler: (payload: T) => void): Unsubscribe;
}

// ── Composition root: everything wired, injected once ────────────────
export interface Services {
  tasks: ITaskService;
  projects: IProjectService;
  areas: IAreaService;
  tags: ITagService;
  attachments: IAttachmentService;
  activity: IActivityService;
  ranking: IRankingService;
  recurrence: IRecurrenceService;
  // future seams — present in the type, may be stubbed at runtime:
  reminders: IReminderService;
  ai: IAIService;
  calendar: ICalendarSyncService;
  email: IEmailIntakeService;
  sync: SyncAdapter;
}
