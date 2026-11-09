import { useSyncExternalStore } from 'react';
import { ENERGY_ORDER, GIFT_ORDER, IMPACT_ORDER, SOUND_ORDER, TIER_ORDER, type EffortTier, type Gift, type HabitSchedule, type Member, type Room, type Tend, type TendKind, type TendStatus, type Win } from '../domain/types';
import { ApiError, call, forgetConnection, isWaking, type Connection } from './api';
import { db, type OutboxOp } from './db';

/** How soon to try again while the habitat wakes up or this device is offline; doubles each time, up to the max. */
const RETRY_FIRST_MS = 6_000;
const RETRY_MAX_MS = 60_000;
/** Failed tries in a row before the banner says changes are waiting (about 40 seconds). */
const WAITING_AFTER = 3;

/*
 * A connected habitat lives on the server. This device keeps a copy in its local database, which
 * every screen reads from. A change is saved to that copy straight away, with an outbox entry in
 * the same transaction; syncNow() sends the outbox in order in the background, then pulls what the
 * rest of the pack did. Pulls wait until the outbox is empty, so the server's older view never
 * overwrites a change that hasn't reached it yet.
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
  /** Reachable, but still not answering after a few tries (waking up, or a fault there). */
  waiting?: boolean;
  /** Why a change didn't reach the habitat, until dismissed. */
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
  sound: string;
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
  schedule: string | null;
  frequencyDays: number | null;
  status: string;
  completedAt: string | null;
  ownerMemberId: string | null;
  openToEveryone: boolean | null;
  availableTo: string[];
  claimMemberId: string | null;
  claimDay: string | null;
  bountyAcorns: number | null;
  bountyPostedAt: string | null;
  lastDoneAt: string | null;
  deletedAt: string | null;
}

interface SyncWin {
  id: string;
  tendId: string;
  tendName: string;
  roomId: string | null;
  roomName: string | null;
  tier: string;
  bountyAcorns: number;
  at: string;
  /** Primary first. */
  memberIds: string[];
  deletedAt: string | null;
}

interface SyncGift {
  id: string;
  kind: string;
  fromMemberId: string;
  toMemberId: string;
  acorns: number;
  sentAt: string;
  seenAt: string | null;
  deletedAt: string | null;
}

interface SyncResponse {
  cursor: string;
  full: boolean;
  /** Who started the habitat. */
  ownerMemberId: string;
  /** Full syncs only: totals for the older wins they leave out. */
  earlier: Earlier | null;
  rooms: SyncRoom[];
  members: SyncMember[];
  tends: SyncTend[];
  wins: SyncWin[];
  gifts: SyncGift[];
}

/** Totals for wins older than a first sync downloads, so purses and the berry jar count everything. */
export interface Earlier {
  tiers: { tier: string; count: number }[];
  shares: { memberId: string; tier: string; share: number }[];
  bounties: { memberId: string; acorns: number }[];
}

/** The same totals with their tiers checked, as the app keeps them. */
export interface EarlierTotals {
  tiers: { tier: EffortTier; count: number }[];
  shares: { memberId: string; tier: EffortTier; share: number }[];
  bounties: { memberId: string; acorns: number }[];
}

export function earlierFromServer(e: Earlier): EarlierTotals {
  return {
    tiers: e.tiers.map((t) => ({ tier: fromServer(t.tier, TIER_ORDER), count: t.count })),
    shares: e.shares.map((s) => ({ memberId: s.memberId, tier: fromServer(s.tier, TIER_ORDER), share: s.share })),
    bounties: e.bounties,
  };
}

const KIND_ORDER: TendKind[] = ['habit', 'quest'];
const STATUS_ORDER: TendStatus[] = ['active', 'paused'];
const SCHEDULE_ORDER: HabitSchedule[] = ['every', 'whenNeeded'];

const toServer = (value: string) => value[0].toUpperCase() + value.slice(1);

/** Strict: a value the app doesn't know is an error, never quietly mapped to something else. */
function fromServer<T extends string>(value: string, allowed: readonly T[]): T {
  const v = value[0].toLowerCase() + value.slice(1);
  if (!allowed.includes(v as T)) throw new Error(`The server sent a value this app doesn't know: “${value}”.`);
  return v as T;
}

const ms = (iso: string | null) => (iso == null ? undefined : Date.parse(iso));
function requiredMs(iso: string | null, problem: string): number {
  if (iso == null) throw new Error(problem);
  return Date.parse(iso);
}
const iso = (ms: number | undefined) => (ms == null ? null : new Date(ms).toISOString());

export function roomFromServer(r: SyncRoom): Room {
  return { id: r.id, name: r.name, sortOrder: r.sortOrder, ...(r.icon && { icon: r.icon }) };
}

export function memberFromServer(m: SyncMember): Member {
  return { id: m.id, name: m.name, animal: m.animal, sound: fromServer(m.sound, SOUND_ORDER) };
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
    ...(t.bountyAcorns != null && { bounty: { acorns: t.bountyAcorns, postedAt: requiredMs(t.bountyPostedAt, `The bounty on “${t.name}” came from the server without when it was posted.`) } }),
  };
  if (fromServer(t.kind, KIND_ORDER) === 'habit') {
    if (!t.roomId || !t.schedule) throw new Error(`The habit “${t.name}” came from the server without a room or schedule.`);
    const habit = { ...common, kind: 'habit' as const, roomId: t.roomId, ...(t.ownerMemberId && { ownerId: t.ownerMemberId }) };
    if (fromServer(t.schedule, SCHEDULE_ORDER) === 'whenNeeded') return { ...habit, schedule: 'whenNeeded' };
    if (t.frequencyDays == null) throw new Error(`The habit “${t.name}” came from the server without how often it comes back.`);
    return { ...habit, schedule: 'every', frequencyDays: t.frequencyDays };
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
    tier: fromServer(w.tier, TIER_ORDER),
    memberId,
    ...(helperIds.length && { helperIds }),
    ...(w.bountyAcorns > 0 && { bounty: w.bountyAcorns }),
    at: ms(w.at)!,
  };
}

export function giftFromServer(g: SyncGift): Gift {
  return {
    id: g.id,
    kind: fromServer(g.kind, GIFT_ORDER),
    fromId: g.fromMemberId,
    toId: g.toMemberId,
    acorns: g.acorns,
    sentAt: Date.parse(g.sentAt),
    ...(g.seenAt && { seenAt: Date.parse(g.seenAt) }),
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
    schedule: t.kind === 'habit' ? toServer(t.schedule) : null,
    frequencyDays: t.kind === 'habit' && t.schedule === 'every' ? t.frequencyDays : null,
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
  schedule: { name: 'schedule', value: toServer },
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

/** A change for the outbox. */
const op = (method: OutboxOp['method'], path: string, what: string, body?: unknown): OutboxOp => ({ method, path, what, ...(body !== undefined && { body }) });

/** Every change a device can make, as outbox entries. Each is safe to send twice: a repeat changes nothing. */
export const server = {
  putTend: (t: Tend) => op('PUT', `/tends/${t.id}`, `The change to “${t.name}”`, tendToServer(t)),
  patchTend: (t: Tend, patch: Record<string, unknown>) => op('PATCH', `/tends/${t.id}`, `The change to “${t.name}”`, patchToServer(patch)),
  deleteTend: (t: Tend) => op('DELETE', `/tends/${t.id}`, `Removing “${t.name}”`),
  restartQuest: (t: Tend) => op('POST', `/tends/${t.id}/restart`, `Restarting “${t.name}”`),
  claim: (t: Tend, memberId: string) => op('PUT', `/tends/${t.id}/claim`, `Claiming “${t.name}”`, { memberId }),
  releaseClaim: (t: Tend) => op('DELETE', `/tends/${t.id}/claim`, `Letting go of “${t.name}”`),
  putBounty: (t: Tend, acorns: number) => op('PUT', `/tends/${t.id}/bounty`, `The bounty on “${t.name}”`, { acorns }),
  removeBounty: (t: Tend) => op('DELETE', `/tends/${t.id}/bounty`, `Taking down the bounty on “${t.name}”`),
  putRoom: (r: Room) => op('PUT', `/rooms/${r.id}`, `The room “${r.name}”`, { name: r.name, icon: r.icon ?? null, sortOrder: r.sortOrder }),
  deleteRoom: (r: Room) => op('DELETE', `/rooms/${r.id}`, `Removing the room “${r.name}”`),
  putMember: (m: Member) => op('PUT', `/members/${m.id}`, `The change to ${m.name}`, { name: m.name, animal: m.animal, sound: toServer(m.sound) }),
  putWin: (w: Win, memberIds: string[]) => op('PUT', `/wins/${w.id}`, `Ticking off “${w.tendName}”`, { tendId: w.tendId, memberIds, at: iso(w.at) }),
  deleteWin: (w: Win) => op('DELETE', `/wins/${w.id}`, `Undoing “${w.tendName}”`),
  putGift: (g: Gift, what: string) => op('PUT', `/gifts/${g.id}`, what, { kind: toServer(g.kind), fromMemberId: g.fromId, toMemberId: g.toId, acorns: g.acorns, sentAt: iso(g.sentAt) }),
  giftSeen: (g: Gift) => op('POST', `/gifts/${g.id}/seen`, 'Marking a hug as seen'),
};

/** For the few changes that go to the server directly (they need a user's sign-in, or the server's answer). */
async function sendNow(path: string, method: string, body?: unknown, bearer = connection?.deviceToken): Promise<void> {
  if (!connection) throw new Error('Not connected to a habitat.');
  try {
    await call(`/api${path}`, { method, body, bearer });
  } catch (e) {
    if (signedOut(e)) throw e;
    if (e instanceof ApiError && e.status === 0) throw new Error('Can’t reach the habitat right now, so that wasn’t saved. Try again in a moment.');
    throw e;
  }
}

const BULK_MAX = 1000;

/** Changes that wait for the server's answer instead of going through the outbox. */
export const direct = {
  /** Only users may remove someone from the pack, so this takes their sign-in token rather than the device's. */
  deleteMember: (id: string, userToken: string) => sendNow(`/members/${id}`, 'DELETE', undefined, userToken),
  putMember: (m: Member) => sendNow(`/members/${m.id}`, 'PUT', server.putMember(m).body),
  putRoom: (r: Room) => sendNow(`/rooms/${r.id}`, 'PUT', server.putRoom(r).body),
  deleteTend: (id: string) => sendNow(`/tends/${id}`, 'DELETE'),
  async bulkTends(tends: Tend[]): Promise<void> {
    for (let i = 0; i < tends.length; i += BULK_MAX) {
      await sendNow('/tends/bulk', 'POST', { tends: tends.slice(i, i + BULK_MAX).map((t) => ({ id: t.id, tend: tendToServer(t) })) });
    }
  },
};

/**
 * Before a direct change: sends everything queued first, so the server sees changes in the order
 * they were made. Throws if some are still waiting (offline, or the habitat is waking up).
 */
export async function sendQueuedFirst(): Promise<void> {
  await syncNow();
  if (await db.outbox.count()) throw new Error('Some changes are still on their way to the habitat. Try again once they’re through.');
}

/** The server already did what this asked: it's gone, so there's nothing left to remove. */
export const alreadyDone = (o: Pick<OutboxOp, 'method'>, e: unknown) => o.method === 'DELETE' && e instanceof ApiError && (e.status === 404 || e.status === 410);

/** The server said no to a change (rather than not answering, or not knowing this device). */
export const refused = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429;

/**
 * Sends the outbox, oldest first, until it's empty; throws the error that stopped it (offline,
 * waking, signed out). A change the server refuses is dropped and noted in the banner, and the
 * caller downloads the whole habitat again so this device matches it.
 */
async function flush(target: typeof db, c: Connection): Promise<{ refusedAny: boolean }> {
  let refusedAny = false;
  for (;;) {
    const next = await target.outbox.orderBy('seq').first();
    if (!next) return { refusedAny };
    try {
      await call(`/api${next.path}`, { method: next.method, body: next.body, bearer: c.deviceToken });
    } catch (e) {
      if (!alreadyDone(next, e)) {
        if (!refused(e)) throw e;
        refusedAny = true;
        const why = e instanceof Error ? e.message.replace(/\.$/, '') : 'it said no';
        setStatus({ ...status, problem: `${next.what} didn’t reach the habitat (${why}), so this device has been put back to match it.` });
      }
    }
    await target.outbox.delete(next.seq!);
  }
}

// ---- Pull ----

function missingEarlier(): never {
  throw new Error('The habitat’s first download came without its totals for older wins.');
}

/** The server's win, plus the undo details only this device recorded when it logged it. */
export function keepLocalWinFields(w: Win, local: Win | undefined): Win {
  if (!local) return w;
  return { ...w, ...('prevLastDone' in local && { prevLastDone: local.prevLastDone }), ...(local.completedQuest && { completedQuest: true }) };
}

/** Copies everything that changed on the server since the last pull into this device's database. */
async function pull(target: typeof db, c: Connection): Promise<void> {
  // A device that first synced before totals for older wins existed downloads everything once more to get them.
  const since = (await target.meta.get('earlier')) ? ((await target.meta.get('cursor'))?.value ?? '0') : '0';
  const r = await call<SyncResponse>(`/api/sync?since=${encodeURIComponent(since)}`, { bearer: c.deviceToken });
  await target.transaction('rw', [target.rooms, target.tends, target.members, target.wins, target.meta, target.outbox, target.gifts], async () => {
    // Something changed here while this downloaded. Skip it: the next run sends that, then pulls again.
    if (await target.outbox.count()) return;
    const incomingWins = r.wins.filter((x) => !x.deletedAt).map(winFromServer);
    const known = await target.wins.bulkGet(incomingWins.map((w) => w.id));
    // A full sync is the whole habitat: anything else on this device is out of date.
    if (r.full) await Promise.all([target.rooms.clear(), target.tends.clear(), target.members.clear(), target.wins.clear(), target.gifts.clear()]);
    const removed = <T extends { id: string; deletedAt: string | null }>(rows: T[]) => rows.filter((x) => x.deletedAt).map((x) => x.id);
    const kept = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((x) => !x.deletedAt);
    await target.rooms.bulkDelete(removed(r.rooms));
    await target.rooms.bulkPut(kept(r.rooms).map(roomFromServer));
    await target.members.bulkDelete(removed(r.members));
    await target.members.bulkPut(kept(r.members).map(memberFromServer));
    await target.tends.bulkDelete(removed(r.tends));
    await target.tends.bulkPut(kept(r.tends).map(tendFromServer));
    await target.wins.bulkDelete(removed(r.wins));
    await target.wins.bulkPut(incomingWins.map((w, i) => keepLocalWinFields(w, known[i])));
    await target.gifts.bulkDelete(removed(r.gifts));
    await target.gifts.bulkPut(kept(r.gifts).map(giftFromServer));
    await target.meta.put({ key: 'owner', value: r.ownerMemberId });
    if (r.full) await target.meta.put({ key: 'earlier', value: JSON.stringify(earlierFromServer(r.earlier ?? missingEarlier())) });
    await target.meta.put({ key: 'cursor', value: r.cursor });
  });
}

let queued: Promise<void> | undefined;
let chain: Promise<void> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = RETRY_FIRST_MS;
let failures = 0;

function retryLater(): void {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void syncNow(), retryDelay);
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
}

/**
 * Sends anything waiting in the outbox, then pulls: now, or straight after the run already going
 * (so changes made meanwhile aren't missed). Calls that arrive while one is waiting share it.
 * Never throws: problems show in the banner, and an unreachable or waking habitat is tried again.
 */
export function syncNow(): Promise<void> {
  if (!connection) return Promise.resolve();
  if (queued) return queued;
  const next = chain.then(async () => {
    queued = undefined;
    const c = connection;
    // The habitat could change while this runs; keep to the one it started with.
    const target = db;
    if (!c) return;
    try {
      const { refusedAny } = await flush(target, c);
      if (refusedAny) await target.meta.delete('cursor');
      await pull(target, c);
      clearTimeout(retryTimer);
      retryDelay = RETRY_FIRST_MS;
      failures = 0;
      if (!status.online || status.waiting) setStatus({ ...status, online: true, waiting: false });
    } catch (e) {
      if (signedOut(e)) return;
      if (isWaking(e)) {
        failures++;
        const online = !(e instanceof ApiError && e.status === 0);
        const waiting = failures >= WAITING_AFTER;
        if (online !== status.online || waiting !== !!status.waiting) setStatus({ ...status, online, waiting });
        retryLater();
      } else setStatus({ ...status, problem: `Couldn’t update from the habitat: ${e instanceof Error ? e.message : 'something went wrong'}` });
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
