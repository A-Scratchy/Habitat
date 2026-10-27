import { useSyncExternalStore } from 'react';
import { ENERGY_ORDER, IMPACT_ORDER, TIER_ORDER, type Member, type Room, type Tend, type TendKind, type TendStatus, type Win } from '../domain/types';
import { ApiError, call, forgetConnection, type Connection } from './api';
import { db } from './db';

/*
 * A connected habitat lives on the server. This device keeps a copy in its local database, which
 * every screen reads from: changes go to the server first and are copied locally once it says yes,
 * and pull() keeps the copy up to date with what the rest of the pack did.
 * There's no offline queue yet: without a connection, changes aren't saved.
 */

/** The habitat this device is connected to; undefined for the demo and local-only habitats. Set by App. */
let connection: Connection | undefined;

export function setRemote(c: Connection | undefined): void {
  connection = c;
}

/** True when changes must go to the server. */
export const isRemote = () => !!connection;

// ---- Status, for the banner ----

export interface SyncStatus {
  /** False once the server couldn't be reached; true again after the next successful pull. */
  online: boolean;
  /** Why the last change wasn't saved, until dismissed. */
  problem?: string;
}

let status: SyncStatus = { online: true };
const listeners = new Set<() => void>();

function setStatus(next: SyncStatus): void {
  status = next;
  listeners.forEach((l) => l());
}

export const dismissProblem = () => setStatus({ ...status, problem: undefined });

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

/** A device the server no longer knows (revoked, or unused too long) goes back to the sign-in page. */
function signedOut(e: unknown): boolean {
  if (!(e instanceof ApiError && e.status === 401)) return false;
  forgetConnection();
  return true;
}

// ---- Server shapes (JSON is camelCase; enums are PascalCase names) ----

interface SyncRoom {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  deletedAt: string | null;
}

interface SyncMember {
  id: string;
  name: string;
  animal: string;
  deletedAt: string | null;
}

interface SyncTend {
  id: string;
  kind: string;
  name: string;
  roomId: string | null;
  group: string | null;
  description: string | null;
  tier: string;
  impact: string;
  energy: string[];
  frequencyDays: number | null;
  status: string;
  completedAt: string | null;
  ownerMemberId: string | null;
  openToEveryone: boolean | null;
  availableTo: string[];
  claimMemberId: string | null;
  claimDay: string | null;
  lastDoneAt: string | null;
  deletedAt: string | null;
}

interface SyncWin {
  id: string;
  tendId: string;
  tendName: string;
  roomId: string | null;
  roomName: string | null;
  at: string;
  /** Primary first. */
  memberIds: string[];
  deletedAt: string | null;
}

interface SyncResponse {
  cursor: string;
  full: boolean;
  rooms: SyncRoom[];
  members: SyncMember[];
  tends: SyncTend[];
  wins: SyncWin[];
}

const KIND_ORDER: TendKind[] = ['habit', 'quest'];
const STATUS_ORDER: TendStatus[] = ['active', 'paused'];

const toServer = (value: string) => value[0].toUpperCase() + value.slice(1);

/** Strict: a value the app doesn't know is an error, never quietly mapped to something else. */
function fromServer<T extends string>(value: string, allowed: readonly T[]): T {
  const v = value[0].toLowerCase() + value.slice(1);
  if (!allowed.includes(v as T)) throw new Error(`The server sent a value this app doesn't know: “${value}”.`);
  return v as T;
}

const ms = (iso: string | null) => (iso == null ? undefined : Date.parse(iso));
const iso = (ms: number | undefined) => (ms == null ? null : new Date(ms).toISOString());

export function roomFromServer(r: SyncRoom): Room {
  return { id: r.id, name: r.name, sortOrder: r.sortOrder, ...(r.icon && { icon: r.icon }) };
}

export function tendFromServer(t: SyncTend): Tend {
  const common = {
    id: t.id,
    name: t.name,
    ...(t.group && { group: t.group }),
    ...(t.description && { description: t.description }),
    tier: fromServer(t.tier, TIER_ORDER),
    impact: fromServer(t.impact, IMPACT_ORDER),
    energy: t.energy.map((e) => fromServer(e, ENERGY_ORDER)),
    status: fromServer(t.status, STATUS_ORDER),
    ...(t.lastDoneAt && { lastDone: ms(t.lastDoneAt) }),
    ...(t.claimMemberId && t.claimDay && { claim: { memberId: t.claimMemberId, day: t.claimDay } }),
  };
  if (fromServer(t.kind, KIND_ORDER) === 'habit') {
    if (!t.roomId || t.frequencyDays == null) throw new Error(`The habit “${t.name}” came from the server without a room or schedule.`);
    return { ...common, kind: 'habit', roomId: t.roomId, frequencyDays: t.frequencyDays, ...(t.ownerMemberId && { ownerId: t.ownerMemberId }) };
  }
  if (t.openToEveryone == null) throw new Error(`The quest “${t.name}” came from the server without saying who can take it on.`);
  return {
    ...common,
    kind: 'quest',
    ...(t.roomId && { roomId: t.roomId }),
    availableTo: t.openToEveryone ? 'everyone' : t.availableTo,
    ...(t.completedAt && { completedAt: ms(t.completedAt) }),
  };
}

export function winFromServer(w: SyncWin): Win {
  const [memberId, ...helperIds] = w.memberIds;
  return {
    id: w.id,
    tendId: w.tendId,
    tendName: w.tendName,
    ...(w.roomId && { roomId: w.roomId }),
    ...(w.roomName && { room: w.roomName }),
    memberId,
    ...(helperIds.length && { helperIds }),
    at: ms(w.at)!,
  };
}

/** Everything the server lets a device set on a habit or quest. Last done and finished dates only count when it's created. */
export function tendToServer(t: Tend) {
  return {
    kind: toServer(t.kind),
    name: t.name,
    roomId: t.roomId ?? null,
    group: t.group ?? null,
    description: t.description ?? null,
    tier: toServer(t.tier),
    impact: toServer(t.impact),
    energy: t.energy.map(toServer),
    frequencyDays: t.kind === 'habit' ? t.frequencyDays : null,
    status: toServer(t.status),
    ownerMemberId: t.kind === 'habit' ? (t.ownerId ?? null) : null,
    seedLastDoneAt: iso(t.lastDone),
    completedAt: t.kind === 'quest' ? iso(t.completedAt) : null,
    openToEveryone: t.kind === 'quest' ? t.availableTo === 'everyone' : null,
    availableTo: t.kind === 'quest' && Array.isArray(t.availableTo) ? t.availableTo : null,
  };
}

/** Field names and values for a partial change, as the server's PATCH expects. Missing values clear the field. */
const PATCH_FIELDS: Record<string, { name: string; value?: (v: never) => unknown }> = {
  name: { name: 'name' },
  group: { name: 'group' },
  description: { name: 'description' },
  tier: { name: 'tier', value: toServer },
  impact: { name: 'impact', value: toServer },
  status: { name: 'status', value: toServer },
  energy: { name: 'energy', value: (e: string[]) => e.map(toServer) },
  frequencyDays: { name: 'frequencyDays' },
};

export function patchToServer(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch).map(([key, v]) => {
      const field = PATCH_FIELDS[key];
      if (!field) throw new Error(`“${key}” can't be changed this way.`);
      return [field.name, v === undefined ? null : field.value ? field.value(v as never) : v];
    }),
  );
}

// ---- Writes ----

/** Sends one change. If it fails, the banner says why, and the caller's local change is skipped. */
async function send<T = void>(path: string, method: string, body?: unknown, bearer = connection?.deviceToken): Promise<T> {
  if (!connection) throw new Error('Not connected to a habitat.');
  try {
    return await call<T>(`/api${path}`, { method, body, bearer });
  } catch (e) {
    if (!signedOut(e)) {
      const offline = e instanceof ApiError && e.status === 0;
      setStatus({
        online: !offline && status.online,
        problem: offline ? 'Can’t reach the habitat right now, so that wasn’t saved. Try again in a moment.' : `That wasn’t saved: ${e instanceof Error ? e.message : 'something went wrong'}`,
      });
    }
    throw e;
  }
}

const BULK_MAX = 1000;

export const server = {
  putTend: (t: Tend) => send(`/tends/${t.id}`, 'PUT', tendToServer(t)),
  patchTend: (id: string, patch: Record<string, unknown>) => send(`/tends/${id}`, 'PATCH', patchToServer(patch)),
  deleteTend: (id: string) => send(`/tends/${id}`, 'DELETE'),
  restartQuest: (id: string) => send(`/tends/${id}/restart`, 'POST'),
  claim: (id: string, memberId: string) => send(`/tends/${id}/claim`, 'PUT', { memberId }),
  releaseClaim: (id: string) => send(`/tends/${id}/claim`, 'DELETE'),
  async bulkTends(tends: Tend[]): Promise<void> {
    for (let i = 0; i < tends.length; i += BULK_MAX) {
      await send('/tends/bulk', 'POST', { tends: tends.slice(i, i + BULK_MAX).map((t) => ({ id: t.id, tend: tendToServer(t) })) });
    }
  },
  putRoom: (r: Room) => send(`/rooms/${r.id}`, 'PUT', { name: r.name, icon: r.icon ?? null, sortOrder: r.sortOrder }),
  deleteRoom: (id: string) => send(`/rooms/${id}`, 'DELETE'),
  putMember: (m: Member) => send(`/members/${m.id}`, 'PUT', { name: m.name, animal: m.animal }),
  /** Only users may remove someone from the pack, so this takes their sign-in token rather than the device's. */
  deleteMember: (id: string, userToken: string) => send(`/members/${id}`, 'DELETE', undefined, userToken),
  putWin: (id: string, tendId: string, memberIds: string[], at: number) => send(`/wins/${id}`, 'PUT', { tendId, memberIds, at: iso(at) }),
  deleteWin: (id: string) => send(`/wins/${id}`, 'DELETE'),
};

// ---- Pull ----

/** Copies everything that changed on the server since the last pull into this device's database. */
async function pull(): Promise<void> {
  const c = connection;
  // The habitat could change while this runs; keep writing to the one it started with.
  const target = db;
  if (!c) return;
  const since = (await target.meta.get('cursor'))?.value ?? '0';
  const r = await call<SyncResponse>(`/api/sync?since=${encodeURIComponent(since)}`, { bearer: c.deviceToken });
  await target.transaction('rw', [target.rooms, target.tends, target.members, target.wins, target.meta], async () => {
    // A full sync is the whole habitat: anything else on this device is out of date.
    if (r.full) await Promise.all([target.rooms.clear(), target.tends.clear(), target.members.clear(), target.wins.clear()]);
    const removed = <T extends { id: string; deletedAt: string | null }>(rows: T[]) => rows.filter((x) => x.deletedAt).map((x) => x.id);
    const kept = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((x) => !x.deletedAt);
    await target.rooms.bulkDelete(removed(r.rooms));
    await target.rooms.bulkPut(kept(r.rooms).map(roomFromServer));
    await target.members.bulkDelete(removed(r.members));
    await target.members.bulkPut(kept(r.members).map((m) => ({ id: m.id, name: m.name, animal: m.animal })));
    await target.tends.bulkDelete(removed(r.tends));
    await target.tends.bulkPut(kept(r.tends).map(tendFromServer));
    await target.wins.bulkDelete(removed(r.wins));
    await target.wins.bulkPut(kept(r.wins).map(winFromServer));
    await target.meta.put({ key: 'cursor', value: r.cursor });
  });
}

let queued: Promise<void> | undefined;
let chain: Promise<void> = Promise.resolve();

/**
 * Pulls now, or straight after the pull already running (so changes made meanwhile aren't missed).
 * Calls that arrive while one is waiting share it. Never throws: problems show in the banner.
 */
export function syncNow(): Promise<void> {
  if (!connection) return Promise.resolve();
  if (queued) return queued;
  const next = chain.then(async () => {
    queued = undefined;
    try {
      await pull();
      if (!status.online) setStatus({ ...status, online: true });
    } catch (e) {
      if (signedOut(e)) return;
      if (e instanceof ApiError && e.status === 0) setStatus({ ...status, online: false });
      else setStatus({ ...status, problem: `Couldn’t update from the habitat: ${e instanceof Error ? e.message : 'something went wrong'}` });
    }
  });
  queued = next;
  chain = next;
  return next;
}

/** Throws away this device's copy and downloads the whole habitat again. */
export async function redownload(): Promise<void> {
  await db.meta.delete('cursor');
  await syncNow();
}
