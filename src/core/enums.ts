/**
 * Enums — the single source of truth for every closed value set.
 * String-literal unions (not TS `enum`) so they serialize 1:1 with the
 * Postgres enums in supabase/migrations and travel cleanly over JSON/sync.
 */

export const WorkspaceRole = ['owner', 'admin', 'member', 'viewer'] as const;
export type WorkspaceRole = (typeof WorkspaceRole)[number];

export const ProjectStatus = ['active', 'paused', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof ProjectStatus)[number];

export const TaskStatus = ['todo', 'in_progress', 'done', 'canceled'] as const;
export type TaskStatus = (typeof TaskStatus)[number];

/** Ordinal on purpose: Priority.indexOf() gives a comparable rank. */
export const Priority = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof Priority)[number];

export const RecurrenceFreq = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFreq = (typeof RecurrenceFreq)[number];

export const ReminderChannel = ['in_app', 'push', 'email'] as const;
export type ReminderChannel = (typeof ReminderChannel)[number];

export const ReminderStatus = ['scheduled', 'sent', 'dismissed', 'canceled'] as const;
export type ReminderStatus = (typeof ReminderStatus)[number];

export const AttachmentKind = ['file', 'image', 'link'] as const;
export type AttachmentKind = (typeof AttachmentKind)[number];

export const ActivityType = ['created', 'updated', 'completed', 'reopened', 'deleted', 'commented', 'moved'] as const;
export type ActivityType = (typeof ActivityType)[number];

/** What an attachment / activity / integration link points at. */
export const EntityType = ['task', 'project', 'area', 'comment'] as const;
export type EntityType = (typeof EntityType)[number];

export const IntegrationProvider = ['google_calendar', 'apple_calendar', 'email', 'ai'] as const;
export type IntegrationProvider = (typeof IntegrationProvider)[number];

export const TaskSource = ['manual', 'quick_add', 'recurring', 'email', 'ai', 'calendar', 'import'] as const;
export type TaskSource = (typeof TaskSource)[number];
