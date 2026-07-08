/**
 * State management.
 *
 * Shape: a single reactive store holding normalized entities (by id) plus a
 * thin UI slice. The store is the UI's source of truth; services write to it
 * OPTIMISTICALLY, then the SyncAdapter reconciles with the backend in the
 * background. Selectors derive the decision-surface views (today, overdue,
 * project pulse) — nothing computed is ever stored.
 *
 * Framework-agnostic: `subscribe`/`select` drive vanilla DOM today and would
 * back a React `useSyncExternalStore` hook tomorrow with zero core changes.
 */

import type { Store, EventBus, Unsubscribe, SyncState } from './interfaces';
import type { UUID, Task, Project, Area, Tag } from './types';

// ── Normalized state ─────────────────────────────────────────────────
export type ById<T> = Record<UUID, T>;
export interface CoreState {
  workspaceId: UUID | null;
  tasks: ById<Task>;
  projects: ById<Project>;
  areas: ById<Area>;
  tags: ById<Tag>;
  ui: {
    view: 'today' | 'upcoming' | 'anytime' | 'someday' | 'inbox' | 'project' | 'area';
    selectedId: UUID | null;
    inspectorOpen: boolean;
    sync: SyncState;
  };
}
export const initialState = (): CoreState => ({
  workspaceId: null,
  tasks: {}, projects: {}, areas: {}, tags: {},
  ui: { view: 'today', selectedId: null, inspectorOpen: false, sync: 'idle' },
});

// ── Minimal reactive store (no dependencies) ─────────────────────────
export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<(s: S) => void>();
  return {
    getState: () => state,
    setState(patch) {
      const next = typeof patch === 'function' ? (patch as (s: S) => Partial<S>)(state) : patch;
      state = { ...state, ...next };
      listeners.forEach(l => l(state));
    },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    select(selector, listener) {
      let prev = selector(state);
      listener(prev);
      return this.subscribe(s => {
        const nextSel = selector(s);
        if (!Object.is(nextSel, prev)) { prev = nextSel; listener(nextSel); }
      });
    },
  };
}

// ── Event bus (decouples services from UI) ───────────────────────────
export function createEventBus(): EventBus {
  const map = new Map<string, Set<(p: any) => void>>();
  return {
    emit(type, payload) { map.get(type)?.forEach(h => h(payload)); },
    on(type, handler) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)!.add(handler as any);
      return (() => map.get(type)!.delete(handler as any)) as Unsubscribe;
    },
  };
}

// ── Selectors — pure derivations for the decision surface ────────────
const alive = <T extends { deletedAt: string | null }>(m: ById<T>): T[] =>
  Object.values(m).filter(x => !x.deletedAt);

export const selectors = {
  topLevelTasks: (s: CoreState) => alive(s.tasks).filter(t => !t.parentId),
  subtasksOf: (s: CoreState, parentId: UUID) => alive(s.tasks).filter(t => t.parentId === parentId),
  activeProjects: (s: CoreState) => alive(s.projects).filter(p => p.status === 'active'),
  areasSorted: (s: CoreState) => alive(s.areas).sort((a, b) => a.position - b.position),
  inbox: (s: CoreState) =>
    selectors.topLevelTasks(s).filter(t => !t.areaId && !t.projectId && t.status !== 'done'),
};
