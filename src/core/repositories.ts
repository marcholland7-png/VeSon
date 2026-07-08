/**
 * Storage adapters + the offline-first repository.
 *
 * Three adapters implement the SAME `StorageAdapter` interface:
 *   • LocalStorageAdapter  — instant, offline, the UI's fast path
 *   • SupabaseAdapter      — durable, shared, the source of record
 *   • SyncedAdapter        — composes both: read local, write both,
 *                            reconcile with newer-updatedAt-wins + tombstones
 *                            (identical merge protocol to VeSon's calendar sync)
 *
 * Services never import these directly — they receive a `StorageAdapter`.
 * Swapping backends is a one-line change in the composition root (index.ts).
 */

import type { StorageAdapter, SyncAdapter, SyncReport, SyncState } from './interfaces';
import type { AnyEntity, EntityName, UUID, ISODateTime } from './types';
import { fromRow, toRow, nowISO } from './lib';

// ── Local (browser) ──────────────────────────────────────────────────
export class LocalStorageAdapter implements StorageAdapter {
  constructor(private ns = 'veson_v1') {}
  private key(e: EntityName) { return `${this.ns}:${e}`; }
  private all<T>(e: EntityName): Record<UUID, T> {
    try { return JSON.parse(localStorage.getItem(this.key(e)) || '{}'); }
    catch { return {}; }
  }
  private save<T>(e: EntityName, m: Record<UUID, T>) {
    localStorage.setItem(this.key(e), JSON.stringify(m));
  }
  async read<T extends AnyEntity>(e: EntityName, id: UUID) { return (this.all<T>(e)[id] ?? null); }
  async query<T extends AnyEntity>(e: EntityName) {
    return Object.values(this.all<T>(e)).filter(r => !(r as any).deletedAt);
  }
  async write<T extends AnyEntity>(e: EntityName, row: T) {
    const m = this.all<T>(e); m[row.id] = row; this.save(e, m); return row;
  }
  async writeMany<T extends AnyEntity>(e: EntityName, rows: T[]) {
    const m = this.all<T>(e); rows.forEach(r => (m[r.id] = r)); this.save(e, m); return rows;
  }
  async changesSince(e: EntityName, since: ISODateTime | null) {
    return Object.values(this.all<AnyEntity>(e))
      .filter(r => !since || r.updatedAt > since);
  }
}

// ── Supabase (durable) ───────────────────────────────────────────────
// `client` is the @supabase/supabase-js client, injected so core has no
// hard dependency on it (and can be unit-tested with a fake).
export class SupabaseAdapter implements StorageAdapter {
  constructor(private client: any, private table: (e: EntityName) => string = defaultTable) {}
  async read<T extends AnyEntity>(e: EntityName, id: UUID) {
    const { data } = await this.client.from(this.table(e)).select('*').eq('id', id).maybeSingle();
    return data ? (fromRow(data) as T) : null;
  }
  async query<T extends AnyEntity>(e: EntityName) {
    const { data, error } = await this.client.from(this.table(e)).select('*').is('deleted_at', null);
    if (error) throw error;
    return (data ?? []).map(fromRow) as T[];
  }
  async write<T extends AnyEntity>(e: EntityName, row: T) {
    const { data, error } = await this.client.from(this.table(e)).upsert(toRow(row)).select().single();
    if (error) throw error;
    return fromRow(data) as T;
  }
  async writeMany<T extends AnyEntity>(e: EntityName, rows: T[]) {
    const { data, error } = await this.client.from(this.table(e)).upsert(rows.map(toRow)).select();
    if (error) throw error;
    return (data ?? []).map(fromRow) as T[];
  }
  async changesSince(e: EntityName, since: ISODateTime | null) {
    let q = this.client.from(this.table(e)).select('*');
    if (since) q = q.gt('updated_at', since);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(fromRow) as AnyEntity[];
  }
}
const defaultTable = (e: EntityName): string =>
  ({ task: 'tasks', project: 'projects', area: 'areas', tag: 'tags', comment: 'comments',
     reminder: 'reminders', attachment: 'attachments', activity: 'activities',
     integration_link: 'integration_links' } as Record<EntityName, string>)[e];

// ── Synced (offline-first composition) ───────────────────────────────
export class SyncedAdapter implements StorageAdapter, SyncAdapter {
  private state: SyncState = 'idle';
  private cursors: Partial<Record<EntityName, ISODateTime>> = {};
  private subs = new Set<(e: EntityName, rows: AnyEntity[]) => void>();
  constructor(private local: StorageAdapter, private remote: StorageAdapter) {}

  // reads: local-first (instant)
  read: StorageAdapter['read'] = (e, id) => this.local.read(e, id);
  query: StorageAdapter['query'] = (e, q) => this.local.query(e, q);
  changesSince: StorageAdapter['changesSince'] = (e, s) => this.local.changesSince(e, s);

  // writes: local now, remote async (optimistic)
  async write<T extends AnyEntity>(e: EntityName, row: T) {
    const stamped = { ...row, updatedAt: nowISO() } as T;
    await this.local.write(e, stamped);
    this.remote.write(e, stamped).catch(() => (this.state = 'offline'));
    return stamped;
  }
  async writeMany<T extends AnyEntity>(e: EntityName, rows: T[]) {
    await this.local.writeMany(e, rows);
    this.remote.writeMany(e, rows).catch(() => (this.state = 'offline'));
    return rows;
  }

  // ── SyncAdapter ────────────────────────────────────────────────────
  status() { return this.state; }
  onRemoteChange(cb: (e: EntityName, rows: AnyEntity[]) => void) {
    this.subs.add(cb); return () => this.subs.delete(cb);
  }
  async sync(entity?: EntityName) {
    this.state = 'syncing';
    const entities: EntityName[] = entity ? [entity]
      : ['area', 'project', 'task', 'tag', 'comment', 'reminder', 'attachment'];
    let pushed = 0, pulled = 0, conflicts = 0;
    try {
      for (const e of entities) {
        // pull remote changes, merge newer-updatedAt-wins into local
        const remote = await this.remote.changesSince(e, this.cursors[e] ?? null);
        for (const r of remote) {
          const localRow = await this.local.read(e, r.id);
          if (!localRow || r.updatedAt >= localRow.updatedAt) await this.local.write(e, r);
          else conflicts++;
          this.cursors[e] = r.updatedAt > (this.cursors[e] ?? '') ? r.updatedAt : this.cursors[e];
        }
        if (remote.length) { pulled += remote.length; this.subs.forEach(cb => cb(e, remote)); }
      }
      this.state = 'idle';
      return { ok: true as const, value: { pushed, pulled, conflicts } satisfies SyncReport };
    } catch (cause) {
      this.state = 'error';
      return { ok: false as const, error: { code: 'sync_failed', message: 'sync failed', cause } };
    }
  }
}
