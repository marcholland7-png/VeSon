/**
 * Composition root & public API.
 *
 * This is the ONLY file the UI imports from. It wires the object graph once
 * (store → adapters → services) and exposes a single `createTaskCore()`.
 * Swapping storage, adding a real AI/reminder/calendar implementation, or
 * moving the UI to React are all changes *inside* here or behind an interface
 * — never a change the rest of the app has to follow.
 */

export * from './enums';
export * from './types';
export type {
  Result, AppError, Services, Store, EventBus,
  ITaskService, IProjectService, IAreaService, ITagService,
  IRankingService, IReminderService, IAIService,
  ICalendarSyncService, IEmailIntakeService, SyncAdapter,
} from './interfaces';
export { selectors } from './store';
export type { CoreState } from './store';

import { createStore, createEventBus, initialState, type CoreState } from './store';
import { LocalStorageAdapter, SupabaseAdapter, SyncedAdapter } from './repositories';
import { createServices } from './services';
import type { Services } from './interfaces';
import type { UUID } from './types';

export interface TaskCore {
  services: Services;
  store: ReturnType<typeof createStore<CoreState>>;
  bus: ReturnType<typeof createEventBus>;
  /** Load a workspace into the store (local first, then background sync). */
  bootstrap(workspaceId: UUID): Promise<void>;
}

export interface CoreConfig {
  /** Pass a configured @supabase/supabase-js client for durable + shared storage.
   *  Omit it to run purely offline on localStorage (dev / first run). */
  supabaseClient?: unknown;
  namespace?: string;
}

export function createTaskCore(config: CoreConfig = {}): TaskCore {
  const store = createStore<CoreState>(initialState());
  const bus = createEventBus();

  const local = new LocalStorageAdapter(config.namespace ?? 'veson_tasks_v1');
  const adapter = config.supabaseClient
    ? new SyncedAdapter(local, new SupabaseAdapter(config.supabaseClient))
    : local;
  const sync = adapter instanceof SyncedAdapter ? adapter : { sync: async () => ({ ok: true, value: { pushed: 0, pulled: 0, conflicts: 0 } }), onRemoteChange: () => () => {}, status: () => 'idle' as const };

  const services = createServices({ store, bus, adapter, sync });

  return {
    services, store, bus,
    async bootstrap(workspaceId) {
      store.setState({ workspaceId });
      // hydrate store from local cache immediately
      for (const [key, entity] of [['tasks', 'task'], ['projects', 'project'], ['areas', 'area'], ['tags', 'tag']] as const) {
        const rows = await adapter.query(entity);
        store.setState({ [key]: Object.fromEntries(rows.map(r => [r.id, r])) } as any);
      }
      // reconcile with backend in the background (no await → instant UI)
      void sync.sync?.();
    },
  };
}
