/** Small, dependency-free primitives shared across the core. */

import type { Result, AppError } from './interfaces';
import type { RecurrenceRule, ISODate } from './types';

// ── Result helpers (keep throws out of the domain) ───────────────────
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(code: string, message: string, cause?: unknown): Result<T> =>
  ({ ok: false, error: { code, message, cause } });
export async function attempt<T>(fn: () => Promise<T>, code = 'unknown'): Promise<Result<T>> {
  try { return ok(await fn()); }
  catch (e) { return err<T>(code, (e as Error)?.message ?? String(e), e); }
}

// ── IDs & time (client-generatable → offline-first) ──────────────────
export const uuid = (): string =>
  (globalThis.crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));
export const nowISO = (): string => new Date().toISOString();
export const todayISO = (): ISODate => new Date().toISOString().slice(0, 10);
export const addDays = (d: ISODate, n: number): ISODate => {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
};

// ── Recurrence expansion (RRULE subset; pure) ────────────────────────
export function expandRecurrence(rule: RecurrenceRule, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const step = rule.interval || 1;
  let cursor = from;
  let count = 0;
  const end = rule.until && rule.until < to ? rule.until : to;
  while (cursor <= end) {
    const dow = new Date(cursor + 'T00:00:00').getDay();
    const dom = new Date(cursor + 'T00:00:00').getDate();
    const hit =
      rule.freq === 'daily' ||
      (rule.freq === 'weekly' && (rule.byDay?.includes(dow) ?? true)) ||
      (rule.freq === 'monthly' && (rule.byMonthDay?.includes(dom) ?? true)) ||
      (rule.freq === 'yearly');
    if (hit) {
      out.push(cursor);
      if (rule.count && ++count >= rule.count) break;
    }
    cursor = addDays(cursor, rule.freq === 'daily' ? step : 1);
    if (rule.freq === 'weekly' && dow === 6) cursor = addDays(cursor, 7 * (step - 1));
  }
  return out;
}

// ── camelCase ⇄ snake_case (JS domain ⇄ Postgres rows) ───────────────
const snake = (s: string) => s.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const mapKeys = (o: any, fn: (k: string) => string): any =>
  Array.isArray(o) ? o.map(v => mapKeys(v, fn))
    : o && typeof o === 'object' && !(o instanceof Date)
      ? Object.fromEntries(Object.entries(o).map(([k, v]) => [fn(k), mapKeys(v, fn)]))
      : o;
export const toRow = (o: unknown) => mapKeys(o, snake);
export const fromRow = (o: unknown) => mapKeys(o, camel);
