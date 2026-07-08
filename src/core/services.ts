/**
 * Services — the API the UI calls. They own business rules (complete a task,
 * advance a recurrence, compute a focus score), write optimistically to the
 * store, persist via the injected StorageAdapter, and record activities.
 *
 * CRUD flow for every mutation:
 *   UI → Service.method()
 *      → mutate store (optimistic, instant UI)
 *      → adapter.write() (local now + remote async via SyncedAdapter)
 *      → activity.record()
 *      → return Result
 */

import type {
  StorageAdapter, Store, EventBus, Result,
  ITaskService, IProjectService, IAreaService, ITagService,
  IActivityService, IRankingService, IRecurrenceService,
  IReminderService, IAIService, ICalendarSyncService, IEmailIntakeService, Services,
} from './interfaces';
import type {
  UUID, Task, Tag, Activity, ISODate, TaskView, ProjectView, TodayBriefing,
  CreateTaskInput, UpdateTaskInput, TaskQuery, RecurrenceRule,
} from './types';
import { Priority } from './enums';
import type { CoreState } from './store';
import { selectors } from './store';
import { ok, err, uuid, nowISO, todayISO, addDays, expandRecurrence } from './lib';

interface Ctx { store: Store<CoreState>; bus: EventBus; adapter: StorageAdapter; activity: IActivityService; }

// ── Activity ─────────────────────────────────────────────────────────
class ActivityService implements IActivityService {
  constructor(private c: Omit<Ctx, 'activity'>) {}
  async record(a: Omit<Activity, 'id' | 'createdAt' | 'workspaceId'>) {
    const ws = this.c.store.getState().workspaceId;
    if (!ws) return;
    const row: Activity = { ...a, id: uuid(), workspaceId: ws, createdAt: nowISO() };
    await this.c.adapter.write('activity', row);
  }
  async feed(entityId?: UUID, limit = 50): Promise<Result<Activity[]>> {
    const rows = await this.c.adapter.query<Activity>('activity');
    const filtered = (entityId ? rows.filter(r => r.entityId === entityId) : rows)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    return ok(filtered);
  }
}

// ── Ranking (the "decide for me" brain) ──────────────────────────────
class RankingService implements IRankingService {
  constructor(private c: Ctx, private tasks: () => ITaskService, private projects: () => IProjectService) {}
  /** Deterministic score: deadline proximity dominates, then priority, then staleness. */
  focusScore(t: Task): number {
    const today = todayISO();
    let score = 0;
    if (t.dueDate) {
      const days = (new Date(t.dueDate).getTime() - new Date(today).getTime()) / 86_400_000;
      score += days < 0 ? 1000 - days * 10 : Math.max(0, 200 - days * 8); // overdue dominates
    }
    score += Priority.indexOf(t.priority) * 40;
    if (t.doDate === today) score += 60;
    const ageDays = (Date.now() - new Date(t.createdAt).getTime()) / 86_400_000;
    score += Math.min(30, ageDays);                 // gentle staleness nudge
    return Math.round(score);
  }
  async briefing(): Promise<Result<TodayBriefing>> {
    const vRes = await this.tasks().listViews({ filter: { includeCompleted: false } });
    const pRes = await this.projects().listViews();
    if (!vRes.ok) return vRes; if (!pRes.ok) return pRes;
    const today = todayISO();
    const views = vRes.value;
    const overdue = views.filter(t => t.isOverdue);
    const todays = views.filter(t => t.doDate === today && !t.isOverdue);
    const nextUp = views
      .filter(t => !overdue.includes(t) && !todays.includes(t))
      .sort((a, b) => b.focusScore - a.focusScore)[0] ?? null;
    return ok({
      date: today, overdue, today: todays, nextUp,
      projectPulse: pRes.value.filter(p => p.status === 'active'),
      shiftContext: null, // wired later from VeSon's Eitje/calendar modules
    });
  }
  async nextUp() {
    const b = await this.briefing();
    return b.ok ? ok(b.value.nextUp) : b;
  }
}

// ── Recurrence ───────────────────────────────────────────────────────
class RecurrenceService implements IRecurrenceService {
  constructor(private c: Ctx) {}
  expand(rule: RecurrenceRule, from: ISODate, to: ISODate) { return expandRecurrence(rule, from, to); }
  /** Completing a recurring instance materializes the next occurrence. */
  async advance(task: Task): Promise<Result<Task | null>> {
    if (!task.recurrence || !task.doDate) return ok(null);
    const [next] = this.expand(task.recurrence, addDays(task.doDate, 1), addDays(task.doDate, 366));
    if (!next) return ok(null);
    const clone: Task = {
      ...task, id: uuid(), status: 'todo', completedAt: null,
      doDate: next, seriesId: task.seriesId ?? task.id, source: 'recurring',
      createdAt: nowISO(), updatedAt: nowISO(), deletedAt: null,
    };
    await this.c.adapter.write('task', clone);
    this.c.store.setState(s => ({ tasks: { ...s.tasks, [clone.id]: clone } }));
    return ok(clone);
  }
}

// ── Task (the reference implementation for all CRUD) ─────────────────
class TaskService implements ITaskService {
  constructor(
    private c: Ctx,
    private recurrence: IRecurrenceService,
    private ranking: () => RankingService,
  ) {}

  private put(t: Task) { this.c.store.setState(s => ({ tasks: { ...s.tasks, [t.id]: t } })); }

  async get(id: UUID) { return ok(this.c.store.getState().tasks[id] ?? await this.c.adapter.read<Task>('task', id)); }

  async list(query?: TaskQuery): Promise<Result<Task[]>> {
    let rows = selectors.topLevelTasks(this.c.store.getState());
    const f = query?.filter;
    if (f) {
      if (f.areaId !== undefined) rows = rows.filter(t => t.areaId === f.areaId);
      if (f.projectId !== undefined) rows = rows.filter(t => t.projectId === f.projectId);
      if (f.parentId !== undefined) rows = rows.filter(t => t.parentId === f.parentId);
      if (f.status) rows = rows.filter(t => f.status!.includes(t.status));
      if (f.priority) rows = rows.filter(t => f.priority!.includes(t.priority));
      if (!f.includeCompleted) rows = rows.filter(t => t.status !== 'done');
      if (f.search) { const q = f.search.toLowerCase(); rows = rows.filter(t => t.title.toLowerCase().includes(q)); }
    }
    const score = this.ranking().focusScore.bind(this.ranking());
    rows.sort((a, b) => score(b) - score(a));  // smart default sort
    return ok(query?.limit ? rows.slice(0, query.limit) : rows);
  }

  async create(input: CreateTaskInput): Promise<Result<Task>> {
    const ws = this.c.store.getState().workspaceId;
    if (!ws) return err('no_workspace', 'no active workspace');
    const now = nowISO();
    const task: Task = {
      id: input.id ?? uuid(), workspaceId: ws,
      parentId: input.parentId ?? null, projectId: input.projectId ?? null, areaId: input.areaId ?? null,
      title: input.title, notes: input.notes ?? null,
      status: input.status ?? 'todo', priority: input.priority ?? 'none',
      doDate: input.doDate ?? null, dueDate: input.dueDate ?? null, doTime: input.doTime ?? null,
      position: input.position ?? Date.now(), assigneeId: input.assigneeId ?? null,
      source: input.source ?? 'manual', sourceMetadata: input.sourceMetadata ?? {},
      seriesId: input.seriesId ?? null, recurrence: input.recurrence ?? null,
      completedAt: null, metadata: input.metadata ?? {},
      createdBy: input.createdBy ?? null, createdAt: now, updatedAt: now, deletedAt: null,
    };
    this.put(task);
    await this.c.adapter.write('task', task);
    await this.c.activity.record({ actorId: task.createdBy, entityType: 'task', entityId: task.id, type: 'created', changes: {} });
    this.c.bus.emit('task:created', task);
    return ok(task);
  }

  async update(id: UUID, patch: UpdateTaskInput): Promise<Result<Task>> {
    const cur = this.c.store.getState().tasks[id];
    if (!cur) return err('not_found', `task ${id}`);
    const next: Task = { ...cur, ...patch, updatedAt: nowISO() };
    this.put(next);
    await this.c.adapter.write('task', next);
    const changes = Object.fromEntries(
      Object.keys(patch).map(k => [k, [(cur as any)[k], (next as any)[k]] as [any, any]]));
    await this.c.activity.record({ actorId: null, entityType: 'task', entityId: id, type: 'updated', changes });
    this.c.bus.emit('task:updated', next);
    return ok(next);
  }

  async remove(id: UUID): Promise<Result<void>> {
    const r = await this.update(id, { } as UpdateTaskInput);
    if (!r.ok) return r;
    const t = { ...r.value, deletedAt: nowISO() };
    this.put(t); await this.c.adapter.write('task', t);
    this.c.bus.emit('task:deleted', id);
    return ok(undefined);
  }
  async restore(id: UUID): Promise<Result<void>> {
    const cur = await this.c.adapter.read<Task>('task', id);
    if (!cur) return err('not_found', id);
    const t = { ...cur, deletedAt: null, updatedAt: nowISO() };
    this.put(t); await this.c.adapter.write('task', t); return ok(undefined);
  }

  async complete(id: UUID): Promise<Result<Task>> {
    const r = await this.update(id, { status: 'done', completedAt: nowISO() } as UpdateTaskInput);
    if (r.ok) { await this.recurrence.advance(r.value); await this.c.activity.record({ actorId: null, entityType: 'task', entityId: id, type: 'completed', changes: {} }); }
    return r;
  }
  reopen(id: UUID) { return this.update(id, { status: 'todo', completedAt: null } as UpdateTaskInput); }
  reschedule(id: UUID, doDate: ISODate | null) { return this.update(id, { doDate } as UpdateTaskInput); }
  setPriority(id: UUID, priority: Task['priority']) { return this.update(id, { priority } as UpdateTaskInput); }
  move(id: UUID, to: { projectId?: UUID | null; areaId?: UUID | null }) { return this.update(id, to as UpdateTaskInput); }

  async reorder(ids: UUID[]): Promise<Result<void>> {
    await Promise.all(ids.map((id, i) => this.update(id, { position: i } as UpdateTaskInput)));
    return ok(undefined);
  }
  addSubtask(parentId: UUID, input: CreateTaskInput) { return this.create({ ...input, parentId }); }

  async setTags(id: UUID, tagIds: UUID[]): Promise<Result<void>> {
    // task_tags join rows are managed by the adapter; store mirrors via metadata for the view layer
    await this.update(id, { metadata: { ...(this.c.store.getState().tasks[id]?.metadata ?? {}), tagIds } } as UpdateTaskInput);
    return ok(undefined);
  }

  // ── Views (compose entity + relations, compute derived fields) ──────
  async view(id: UUID): Promise<Result<TaskView | null>> {
    const t = this.c.store.getState().tasks[id];
    return ok(t ? this.toView(t) : null);
  }
  async listViews(query?: TaskQuery): Promise<Result<TaskView[]>> {
    const base = await this.list(query);
    return base.ok ? ok(base.value.map(t => this.toView(t))) : base;
  }
  private toView(t: Task): TaskView {
    const subs = selectors.subtasksOf(this.c.store.getState(), t.id).map(s => this.toView(s));
    const done = subs.filter(s => s.status === 'done').length;
    const today = todayISO();
    return {
      ...t, tags: [], subtasks: subs,
      subtaskProgress: subs.length ? done / subs.length : 0,
      isOverdue: !!t.dueDate && t.dueDate < today && t.status !== 'done',
      focusScore: this.ranking().focusScore(t),
      reminderCount: 0, attachmentCount: 0,
    };
  }
}

// ── Container / composition ──────────────────────────────────────────
// Compact peers (Project/Area/Tag) and future stubs live alongside so
// there is exactly ONE place that wires the object graph.
export function createServices(base: { store: Store<CoreState>; bus: EventBus; adapter: StorageAdapter; sync: any }): Services {
  const activity = new ActivityService(base);
  const ctx: Ctx = { ...base, activity };
  let ranking!: RankingService;
  const recurrence = new RecurrenceService(ctx);
  const tasks = new TaskService(ctx, recurrence, () => ranking);

  const projects = makeProjectService(ctx, () => tasks);
  const areas = makeCrud('area') as unknown as IAreaService;
  const tags = makeTagService(ctx);
  ranking = new RankingService(ctx, () => tasks, () => projects);

  const notImpl = (name: string) => new Proxy({}, { get: () => async () =>
    err(`${name}_not_implemented`, `${name} is a defined seam; implement in a later phase`) });

  return {
    tasks, projects, areas, tags, activity, ranking, recurrence,
    attachments: notImpl('attachments') as any,
    reminders: notImpl('reminders') as IReminderService,
    ai: notImpl('ai') as IAIService,
    calendar: notImpl('calendar') as ICalendarSyncService,
    email: notImpl('email') as IEmailIntakeService,
    sync: base.sync,
  };

  // — local helpers keep peers thin; they follow TaskService's exact pattern —
  function makeCrud(entity: 'area') {
    return {
      async get(id: UUID) { return ok(ctx.store.getState().areas[id] ?? null); },
      async list() { return ok(selectors.areasSorted(ctx.store.getState())); },
      async create(input: any) {
        const ws = ctx.store.getState().workspaceId!; const now = nowISO();
        const row = { id: input.id ?? uuid(), workspaceId: ws, position: Date.now(), color: null, icon: null, ...input, createdAt: now, updatedAt: now, deletedAt: null };
        ctx.store.setState(s => ({ areas: { ...s.areas, [row.id]: row } }));
        await ctx.adapter.write(entity, row); return ok(row);
      },
      async update(id: UUID, patch: any) {
        const cur = ctx.store.getState().areas[id]; if (!cur) return err('not_found', id);
        const row = { ...cur, ...patch, updatedAt: nowISO() };
        ctx.store.setState(s => ({ areas: { ...s.areas, [id]: row } }));
        await ctx.adapter.write(entity, row); return ok(row);
      },
      async remove(id: UUID) { return (this as any).update(id, { deletedAt: nowISO() }).then(() => ok(undefined)); },
      async restore(id: UUID) { return (this as any).update(id, { deletedAt: null }).then(() => ok(undefined)); },
    };
  }
}

function makeProjectService(ctx: Ctx, tasks: () => ITaskService): IProjectService {
  const put = (p: any) => ctx.store.setState(s => ({ projects: { ...s.projects, [p.id]: p } }));
  const toView = async (p: any): Promise<ProjectView> => {
    const r = await tasks().list({ filter: { projectId: p.id, includeCompleted: true } });
    const list = r.ok ? r.value : [];
    const done = list.filter(t => t.status === 'done').length;
    const recent = list.filter(t => t.completedAt && Date.now() - new Date(t.completedAt).getTime() < 7 * 864e5).length;
    const next = list.find(t => t.status !== 'done') ?? null;
    return { ...p, taskCount: list.length, doneCount: done, progress: list.length ? done / list.length : 0, momentum: recent, isStalled: recent === 0, nextTask: next };
  };
  return {
    async get(id) { return ok(ctx.store.getState().projects[id] ?? null); },
    async list() { return ok(selectors.activeProjects(ctx.store.getState())); },
    async create(input) {
      const ws = ctx.store.getState().workspaceId!; const now = nowISO();
      const p = { id: input.id ?? uuid(), workspaceId: ws, status: 'active', position: Date.now(), areaId: null, outcome: null, notes: null, targetDate: null, createdBy: null, ...input, createdAt: now, updatedAt: now, deletedAt: null };
      put(p); await ctx.adapter.write('project', p); return ok(p);
    },
    async update(id, patch) {
      const cur = ctx.store.getState().projects[id]; if (!cur) return err('not_found', id);
      const p = { ...cur, ...patch, updatedAt: nowISO() }; put(p); await ctx.adapter.write('project', p); return ok(p);
    },
    async remove(id) { const c = ctx.store.getState().projects[id]; if (!c) return err('not_found', id); const p = { ...c, deletedAt: nowISO() }; put(p); await ctx.adapter.write('project', p); return ok(undefined); },
    async restore(id) { const c = ctx.store.getState().projects[id]; if (!c) return err('not_found', id); const p = { ...c, deletedAt: null }; put(p); await ctx.adapter.write('project', p); return ok(undefined); },
    async view(id) { const p = ctx.store.getState().projects[id]; return ok(p ? await toView(p) : null); },
    async listViews() { return ok(await Promise.all(selectors.activeProjects(ctx.store.getState()).map(toView))); },
    async archive(id) { return this.update(id, { status: 'archived' } as any); },
  };
}

function makeTagService(ctx: Ctx): ITagService {
  return {
    async list() { return ok(Object.values(ctx.store.getState().tags).filter((t: Tag) => !!t)); },
    async ensure(name) {
      const existing = Object.values(ctx.store.getState().tags).find((t: Tag) => t.name === name);
      if (existing) return ok(existing);
      const ws = ctx.store.getState().workspaceId!;
      const tag: Tag = { id: uuid(), workspaceId: ws, name, color: null, createdAt: nowISO() };
      ctx.store.setState(s => ({ tags: { ...s.tags, [tag.id]: tag } }));
      await ctx.adapter.write('tag', tag); return ok(tag);
    },
    async remove(id) { ctx.store.setState(s => { const { [id]: _, ...rest } = s.tags; return { tags: rest }; }); return ok(undefined); },
  };
}
