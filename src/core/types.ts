/**
 * Domain types. Three layers, kept in one file so the shape of the whole
 * system is graspable at a glance:
 *   1. Primitives & base        — ids, timestamps, soft-delete
 *   2. Entities                 — mirror the DB rows exactly
 *   3. DTOs / Queries / Views   — inputs, filters, and read-optimized shapes
 *
 * Rule: entities mirror storage; anything computed (progress, focus score,
 * "overdue") lives in Views and is derived, never persisted.
 */

import type {
  WorkspaceRole, ProjectStatus, TaskStatus, Priority, RecurrenceFreq,
  ReminderChannel, ReminderStatus, AttachmentKind, ActivityType,
  EntityType, IntegrationProvider, TaskSource,
} from './enums';

// ── 1. Primitives & base ─────────────────────────────────────────────
export type UUID = string;
export type ISODate = string;      // 'YYYY-MM-DD'
export type ISOTime = string;      // 'HH:mm'
export type ISODateTime = string;  // RFC 3339
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface Timestamps {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
/** Everything soft-deletes: `deletedAt` is the sync tombstone + undo handle. */
export interface SoftDelete {
  deletedAt: ISODateTime | null;
}
export interface Entity extends Timestamps, SoftDelete {
  id: UUID;
}
/** Every domain row is scoped to a workspace — the collaboration boundary. */
export interface WorkspaceScoped {
  workspaceId: UUID;
}

// ── 2. Entities (1:1 with tables) ────────────────────────────────────
export interface Profile extends Timestamps {
  id: UUID;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface Workspace extends Entity {
  name: string;
  ownerId: UUID;
  isPersonal: boolean;
}

export interface WorkspaceMember {
  workspaceId: UUID;
  userId: UUID;
  role: WorkspaceRole;
  createdAt: ISODateTime;
}

export interface Area extends Entity, WorkspaceScoped {
  name: string;
  color: string | null;
  icon: string | null;
  position: number;
}

export interface Project extends Entity, WorkspaceScoped {
  areaId: UUID | null;
  name: string;
  outcome: string | null;
  notes: string | null;
  status: ProjectStatus;
  targetDate: ISODate | null;
  position: number;
  createdBy: UUID | null;
}

/** Structured recurrence rule (RRULE subset), stored as JSON on the task. */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number;            // every N units
  byDay?: number[];            // 0=Sun … 6=Sat (weekly)
  byMonthDay?: number[];       // 1..31 (monthly)
  until?: ISODate | null;      // end date, or
  count?: number | null;       // total occurrences
}

export interface Task extends Entity, WorkspaceScoped {
  parentId: UUID | null;       // subtasks are tasks with a parent
  projectId: UUID | null;
  areaId: UUID | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: Priority;
  doDate: ISODate | null;      // when I'll work on it
  dueDate: ISODate | null;     // hard deadline
  doTime: ISOTime | null;
  position: number;
  assigneeId: UUID | null;
  source: TaskSource;
  sourceMetadata: Record<string, Json>;
  seriesId: UUID | null;       // groups a recurring series
  recurrence: RecurrenceRule | null;
  completedAt: ISODateTime | null;
  metadata: Record<string, Json>;
  createdBy: UUID | null;
}

export interface Tag extends WorkspaceScoped {
  id: UUID;
  name: string;
  color: string | null;
  createdAt: ISODateTime;
}

export interface Attachment extends WorkspaceScoped {
  id: UUID;
  parentType: EntityType;
  parentId: UUID;
  kind: AttachmentKind;
  name: string;
  url: string | null;
  storagePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdBy: UUID | null;
  createdAt: ISODateTime;
  deletedAt: ISODateTime | null;
}

export interface Reminder extends WorkspaceScoped {
  id: UUID;
  taskId: UUID;
  remindAt: ISODateTime;
  channel: ReminderChannel;
  status: ReminderStatus;
  sentAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface Comment extends Entity, WorkspaceScoped {
  taskId: UUID | null;
  projectId: UUID | null;
  authorId: UUID | null;
  body: string;
}

export interface Activity extends WorkspaceScoped {
  id: UUID;
  actorId: UUID | null;
  entityType: EntityType;
  entityId: UUID;
  type: ActivityType;
  changes: Record<string, [Json, Json]>;  // field -> [old, new]
  createdAt: ISODateTime;
}

export interface IntegrationLink extends WorkspaceScoped {
  id: UUID;
  provider: IntegrationProvider;
  entityType: EntityType;
  entityId: UUID;
  externalId: string;
  externalUrl: string | null;
  syncToken: string | null;
  lastSyncedAt: ISODateTime | null;
  metadata: Record<string, Json>;
  createdAt: ISODateTime;
}

/** Discriminated union of every syncable entity — used by the sync engine. */
export type AnyEntity = Task | Project | Area | Tag | Comment | Reminder | Attachment;
export type EntityName =
  | 'task' | 'project' | 'area' | 'tag' | 'comment'
  | 'reminder' | 'attachment' | 'activity' | 'integration_link';

// ── 3a. DTOs (write inputs) ──────────────────────────────────────────
// Generated/managed fields are never accepted from callers.
type Managed = 'id' | keyof Timestamps | keyof SoftDelete;

export type CreateTaskInput =
  Omit<Task, Managed | 'completedAt'> & { id?: UUID };  // id optional → client can pre-generate
export type UpdateTaskInput = Partial<Omit<Task, Managed | 'workspaceId'>>;

export type CreateProjectInput = Omit<Project, Managed> & { id?: UUID };
export type UpdateProjectInput = Partial<Omit<Project, Managed | 'workspaceId'>>;

export type CreateAreaInput = Omit<Area, Managed> & { id?: UUID };
export type UpdateAreaInput = Partial<Omit<Area, Managed | 'workspaceId'>>;

export type CreateTagInput = Omit<Tag, 'id' | 'createdAt'> & { id?: UUID };
export type CreateReminderInput = Omit<Reminder, 'id' | 'createdAt' | 'sentAt' | 'status'>;
export type CreateCommentInput = Omit<Comment, Managed>;

// ── 3b. Queries (read inputs) ────────────────────────────────────────
export type SortDir = 'asc' | 'desc';
export interface Sort<T> { field: keyof T; dir: SortDir; }

export interface TaskFilter {
  areaId?: UUID | null;
  projectId?: UUID | null;
  parentId?: UUID | null;          // null → top-level only
  status?: TaskStatus[];
  priority?: Priority[];
  tagIds?: UUID[];
  assigneeId?: UUID;
  /** Semantic buckets the ranking layer understands. */
  bucket?: 'inbox' | 'today' | 'overdue' | 'upcoming' | 'anytime' | 'someday';
  doDateFrom?: ISODate; doDateTo?: ISODate;
  dueDateFrom?: ISODate; dueDateTo?: ISODate;
  search?: string;
  includeCompleted?: boolean;      // default false
}
export interface TaskQuery {
  filter?: TaskFilter;
  sort?: Sort<Task>[];             // default: smart (focus score) ordering
  limit?: number;
  cursor?: string;                 // keyset pagination
}

// ── 3c. Views (read-optimized, computed — never stored) ──────────────
export interface TaskView extends Task {
  tags: Tag[];
  subtasks: TaskView[];
  subtaskProgress: number;         // 0..1
  isOverdue: boolean;
  focusScore: number;              // ranking output (see ranking service)
  reminderCount: number;
  attachmentCount: number;
}

export interface ProjectView extends Project {
  taskCount: number;
  doneCount: number;
  progress: number;                // doneCount / taskCount
  momentum: number;                // tasks completed in last 7d
  isStalled: boolean;              // no activity > N days
  nextTask: Task | null;
}

/** The Today decision surface, precomputed for the UI. */
export interface TodayBriefing {
  date: ISODate;
  overdue: TaskView[];
  today: TaskView[];
  nextUp: TaskView | null;
  projectPulse: ProjectView[];
  /** VeSon's edge: schedule-aware summary line. */
  shiftContext: { nextShiftAt: ISODateTime | null; focusHoursLeft: number } | null;
}
