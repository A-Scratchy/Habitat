import { dayKey } from '../domain/dates';
import { type ParsedTend } from '../domain/csv';
import { mockHistory } from '../domain/mock';
import { BOUNTY_MAX, bountyFor, GIFTS, purse, readEarlier } from '../domain/acorns';
import { ANIMALS, byRoomOrder, DEFAULT_SOUND, type DistributiveOmit, type Gift, type GiftKind, type Member, type Room, type Tend, type Win } from '../domain/types';
import { userToken } from '../auth/entra';
import { db, newId, type OutboxOp } from './db';
import { direct, isRemote, redownload, sendQueuedFirst, server, syncNow } from './remote';

/*
 * Every change is saved on this device first, so the screens update straight away. In a connected
 * habitat the same transaction adds it to the outbox, and the outbox is sent in the background
 * (see syncNow); the pull after it brings back anything the server worked out itself, like
 * last-done dates. The few changes that need a user's sign-in or the server's answer still wait
 * for it, after anything already queued.
 */

/** Queues changes for the server. Call inside a transaction that includes db.outbox, so the change and its entry are saved together. */
async function queue(...ops: OutboxOp[]): Promise<void> {
  if (isRemote() && ops.length) await db.outbox.bulkAdd(ops);
}

/** Starts sending what was queued, without waiting. */
const send = () => void syncNow();

async function tendOrThrow(id: string): Promise<Tend> {
  const tend = await db.tends.get(id);
  if (!tend) throw new Error('That habit or quest isn’t here any more.');
  return tend;
}

/**
 * Logs a win per tend, credited to the first member with the rest tagged as helpers.
 * `at` may be backdated ("forgot to tick it off"); lastDone only ever moves forward.
 * Doing an open quest finishes it: it moves to the Completed shelf.
 * Returns the win ids so the toast can undo them.
 */
export async function completeTends(tendIds: string[], memberIds: string[], at = Date.now()): Promise<string[]> {
  const [memberId, ...helperIds] = memberIds;
  const ids = await db.transaction('rw', [db.tends, db.wins, db.rooms, db.outbox], async () => {
    const ids: string[] = [];
    for (const tend of await db.tends.bulkGet(tendIds)) {
      if (!tend) continue;
      const finishesQuest = tend.kind === 'quest' && tend.completedAt == null;
      const room = tend.roomId ? (await db.rooms.get(tend.roomId))?.name : undefined;
      const win: Win = { id: newId(), tendId: tend.id, tendName: tend.name, ...(tend.roomId && { roomId: tend.roomId, room }), tier: tend.tier, memberId, at, prevLastDone: tend.lastDone };
      if (helperIds.length) win.helperIds = helperIds;
      if (finishesQuest) win.completedQuest = true;
      // The first win since a bounty went up pays it, and takes it off the board (as the server does).
      const bounty = bountyFor(tend, at);
      if (bounty) win.bounty = bounty;
      await db.wins.put(win);
      await queue(server.putWin(win, memberIds));
      if (bounty) await db.tends.update(tend.id, { bounty: undefined });
      if (finishesQuest) await db.tends.update(tend.id, { completedAt: at, claim: undefined });
      if (tend.lastDone == null || at > tend.lastDone) {
        await db.tends.update(tend.id, { lastDone: at, ...(dayKey(at) === dayKey(Date.now()) && { claim: undefined }) });
      }
      ids.push(win.id);
    }
    return ids;
  });
  send();
  return ids;
}

export async function undoWins(winIds: string[]): Promise<void> {
  await db.transaction('rw', [db.tends, db.wins, db.outbox], async () => {
    for (const win of await db.wins.bulkGet(winIds)) {
      if (!win) continue;
      const tend = await db.tends.get(win.tendId);
      // Only roll back if nothing newer has been logged since. (A connected habitat's server works
      // it out again from the wins that are left, and the next pull brings that back.)
      if (tend && tend.lastDone === win.at) await db.tends.update(tend.id, { lastDone: win.prevLastDone });
      // Undoing the win that finished a quest puts it back on the open list.
      if (tend?.kind === 'quest' && win.completedQuest && tend.completedAt === win.at) await db.tends.update(tend.id, { completedAt: undefined });
      // Undoing the win that paid a bounty puts it back on the board, unless another has gone up since.
      if (tend && win.bounty && !tend.bounty) await db.tends.update(tend.id, { bounty: { acorns: win.bounty, postedAt: win.at } });
      await db.wins.delete(win.id);
      await queue(server.deleteWin(win));
    }
  });
  send();
}

/** Saves a change to one tend and queues it for the server. */
async function changeTend(id: string, change: (tend: Tend) => { patch: Partial<Tend>; op: OutboxOp }): Promise<void> {
  await db.transaction('rw', db.tends, db.outbox, async () => {
    const tend = await tendOrThrow(id);
    const { patch, op } = change(tend);
    await db.tends.update(id, patch);
    await queue(op);
  });
  send();
}

export function claimToday(tendId: string, memberId: string): Promise<void> {
  return changeTend(tendId, (t) => ({ patch: { claim: { memberId, day: dayKey(Date.now()) } }, op: server.claim(t, memberId) }));
}

export function releaseClaim(tendId: string): Promise<void> {
  return changeTend(tendId, (t) => ({ patch: { claim: undefined }, op: server.releaseClaim(t) }));
}

/** Puts it on the bounty board, or changes the reward (keeping its place on the board). */
export function postBounty(tendId: string, acorns: number): Promise<void> {
  if (!Number.isInteger(acorns) || acorns < 1 || acorns > BOUNTY_MAX) throw new Error(`A bounty is between 1 and ${BOUNTY_MAX} acorns.`);
  return changeTend(tendId, (t) => ({ patch: { bounty: { acorns, postedAt: t.bounty?.postedAt ?? Date.now() } }, op: server.putBounty(t, acorns) }));
}

export function removeBounty(tendId: string): Promise<void> {
  return changeTend(tendId, (t) => ({ patch: { bounty: undefined }, op: server.removeBounty(t) }));
}

/** Spends the sender's acorns on a hug, high-five or thank you for someone else in the pack. */
export async function sendGift(kind: GiftKind, fromId: string, toId: string): Promise<Gift> {
  if (fromId === toId) throw new Error('Send it to someone else in the pack.');
  const { acorns, label } = GIFTS[kind];
  const gift = await db.transaction('rw', [db.wins, db.gifts, db.meta, db.members, db.outbox], async () => {
    const [wins, gifts, earlier, to] = await Promise.all([db.wins.toArray(), db.gifts.toArray(), db.meta.get('earlier'), db.members.get(toId)]);
    if (!to) throw new Error('They’re not in the pack any more.');
    if (purse(wins, gifts, fromId, readEarlier(earlier?.value)) < acorns) throw new Error(`Not enough acorns yet: a ${label.toLowerCase()} is ${acorns}.`);
    const gift: Gift = { id: newId(), kind, fromId, toId, acorns, sentAt: Date.now() };
    await db.gifts.add(gift);
    await queue(server.putGift(gift, `The ${label.toLowerCase()} for ${to.name}`));
    return gift;
  });
  send();
  return gift;
}

/** Whoever it was for has seen it, so it isn't shown again (on any device). */
export async function giftSeen(id: string): Promise<void> {
  await db.transaction('rw', db.gifts, db.outbox, async () => {
    const gift = await db.gifts.get(id);
    if (!gift || gift.seenAt) return;
    await db.gifts.update(id, { seenAt: Date.now() });
    await queue(server.giftSeen(gift));
  });
  send();
}

/** Fields every tend has. Kind-specific changes (room, schedule, finishing) go through saveTend, setFrequency or restartQuest. */
export type CommonTendFields = Pick<Tend, 'name' | 'group' | 'description' | 'tier' | 'impact' | 'energy' | 'status'>;

export function updateTend(id: string, patch: Partial<CommonTendFields>): Promise<void> {
  return changeTend(id, (t) => ({ patch, op: server.patchTend({ ...t, ...patch } as Tend, patch) }));
}

/** Habits only: how often it comes back, every so many days or whenever it's needed. */
export function setFrequency(id: string, every: number | 'whenNeeded'): Promise<void> {
  const change = every === 'whenNeeded' ? { schedule: 'whenNeeded' as const, frequencyDays: undefined } : { schedule: 'every' as const, frequencyDays: every };
  return changeTend(id, (t) => {
    if (t.kind !== 'habit') throw new Error('Only habits have a frequency.');
    return { patch: change, op: server.patchTend(t, change) };
  });
}

/** Takes a quest off the Completed shelf so it can be done again. */
export function restartQuest(id: string): Promise<void> {
  return changeTend(id, (t) => {
    if (t.kind !== 'quest') throw new Error('Only quests can be restarted.');
    return { patch: { completedAt: undefined }, op: server.restartQuest(t) };
  });
}

/** Creates or fully replaces a tend (the editor, including switching between habit and quest). */
export async function saveTend(tend: DistributiveOmit<Tend, 'id'> & { id?: string }): Promise<void> {
  const full = { ...tend, id: tend.id ?? newId() } as Tend;
  await db.transaction('rw', db.tends, db.outbox, async () => {
    await db.tends.put(full);
    await queue(server.putTend(full));
  });
  send();
}

export async function deleteTend(id: string): Promise<void> {
  await db.transaction('rw', db.tends, db.outbox, async () => {
    const tend = await db.tends.get(id);
    if (!tend) return;
    await db.tends.delete(id);
    await queue(server.deleteTend(tend));
  });
  send();
}

/** Adds or updates a room. Names are unique in the habitat (ignoring case). */
export async function saveRoom(room: Omit<Room, 'id' | 'sortOrder'> & { id?: string; sortOrder?: number }): Promise<string> {
  const name = room.name.trim();
  if (!name || name.length > 40) throw new Error('A room needs a name of up to 40 characters.');
  const id = await db.transaction('rw', db.rooms, db.outbox, async () => {
    const all = await db.rooms.toArray();
    if (all.some((r) => r.id !== room.id && r.name.toLowerCase() === name.toLowerCase())) throw new Error(`There's already a room called “${name}”.`);
    const id = room.id ?? newId();
    const sortOrder = room.sortOrder ?? all.find((r) => r.id === id)?.sortOrder ?? Math.max(-1, ...all.map((r) => r.sortOrder)) + 1;
    const saved: Room = { id, name, sortOrder, ...(room.icon?.trim() && { icon: room.icon.trim() }) };
    await db.rooms.put(saved);
    await queue(server.putRoom(saved));
    return id;
  });
  send();
  return id;
}

/** Removes a room, but only once it's empty, so no habit or quest is ever left without one. */
export async function deleteRoom(id: string): Promise<void> {
  await db.transaction('rw', db.rooms, db.tends, db.outbox, async () => {
    const inUse = await db.tends.where('roomId').equals(id).count();
    if (inUse) throw new Error(`Move or remove its ${inUse} habits and quests first.`);
    const room = await db.rooms.get(id);
    if (!room) return;
    await db.rooms.delete(id);
    await queue(server.deleteRoom(room));
  });
  send();
}

/** Swaps a room with its neighbour in the list (-1 = up, +1 = down). */
export async function moveRoom(id: string, direction: -1 | 1): Promise<void> {
  await db.transaction('rw', db.rooms, db.outbox, async () => {
    const rooms = (await db.rooms.toArray()).sort(byRoomOrder);
    const i = rooms.findIndex((r) => r.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= rooms.length) return;
    // Renumber the whole list so ties and gaps from older data can't make the swap a no-op.
    [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
    const renumbered = rooms.map((r, n) => ({ ...r, sortOrder: n }));
    await db.rooms.bulkPut(renumbered);
    await queue(...renumbered.filter((r) => r.sortOrder !== rooms.find((x) => x.id === r.id)!.sortOrder).map(server.putRoom));
  });
  send();
}

export async function saveMember(member: Omit<Member, 'id'> & { id?: string }): Promise<string> {
  const saved: Member = { ...member, id: member.id ?? newId() };
  await db.transaction('rw', db.members, db.outbox, async () => {
    await db.members.put(saved);
    await queue(server.putMember(saved));
  });
  send();
  return saved.id;
}

export async function deleteMember(id: string): Promise<void> {
  if (isRemote()) {
    // Only a signed-in user may remove someone; the server also frees up their habits and quests.
    await sendQueuedFirst();
    await direct.deleteMember(id, await userToken());
    await db.members.delete(id);
    await syncNow();
    return;
  }
  await db.transaction('rw', db.members, db.tends, async () => {
    await db.members.delete(id);
    await db.tends.filter((t) => t.ownerId === id).modify((t) => void delete t.ownerId);
    // A quest only they could do is left with nobody; Tending flags it so it can be reassigned.
    await db.tends
      .filter((t) => t.kind === 'quest' && Array.isArray(t.availableTo) && t.availableTo.includes(id))
      .modify((t) => {
        if (t.kind === 'quest' && Array.isArray(t.availableTo)) t.availableTo = t.availableTo.filter((m) => m !== id);
      });
  });
}


export interface ImportOptions {
  replace: boolean;
  /** Pretend history for trying things out. Never in a connected habitat: the pack's wins are real. */
  mockDates: boolean;
}

/** Imports parsed rows, creating members for any owners named in the file. */
export async function importTends(parsed: ParsedTend[], opts: ImportOptions): Promise<number> {
  if (isRemote() && opts.mockDates) throw new Error('Pretend dates are only for the demo and local habitats.');
  const members = await db.members.toArray();
  const byName = new Map(members.map((m) => [m.name.toLowerCase(), m]));
  const newMembers: Member[] = [];
  // Members named as owners or in Available To are matched by name, or created.
  const named = parsed.flatMap((p) => [p.ownerName, ...(Array.isArray(p.availableToNames) ? p.availableToNames : [])]);
  for (const name of named) {
    if (!name || byName.has(name.toLowerCase())) continue;
    const m: Member = { id: newId(), name, animal: ANIMALS[members.length % ANIMALS.length], sound: DEFAULT_SOUND };
    members.push(m);
    newMembers.push(m);
    byName.set(m.name.toLowerCase(), m);
  }

  // Rooms are matched by name (ignoring case); new names become new rooms, in the order the file lists them.
  const rooms = await db.rooms.toArray();
  const roomByName = new Map(rooms.map((r) => [r.name.toLowerCase(), r]));
  const newRooms: Room[] = [];
  let nextOrder = Math.max(-1, ...rooms.map((r) => r.sortOrder)) + 1;
  for (const p of parsed) {
    if (!p.roomName || roomByName.has(p.roomName.toLowerCase())) continue;
    const room: Room = { id: newId(), name: p.roomName, sortOrder: nextOrder++ };
    rooms.push(room);
    newRooms.push(room);
    roomByName.set(room.name.toLowerCase(), room);
  }

  const now = Date.now();
  const memberId = (name: string) => byName.get(name.toLowerCase())!.id;
  let tends: Tend[] = parsed.map(({ ownerName, availableToNames, completed, roomName, ...rest }) => {
    const roomId = roomName ? roomByName.get(roomName.toLowerCase())!.id : undefined;
    if (rest.kind === 'quest') {
      if (!availableToNames) throw new Error(`“${rest.name}” is a quest that doesn’t say who can take it on.`);
      const availableTo = availableToNames === 'everyone' ? 'everyone' : availableToNames.map(memberId);
      return { ...rest, id: newId(), ...(roomId && { roomId }), availableTo, ...(completed && { completedAt: rest.lastDone ?? now }) };
    }
    if (!roomId) throw new Error(`“${rest.name}” is a habit with no room.`);
    return { ...rest, id: newId(), roomId, ...(ownerName && { ownerId: memberId(ownerName) }) };
  });

  if (isRemote()) {
    // Imports wait for the server, after anything already queued: the server owns the last-done dates.
    await sendQueuedFirst();
    for (const m of newMembers) await direct.putMember(m);
    for (const r of newRooms) await direct.putRoom(r);
    if (opts.replace) for (const t of await db.tends.toArray()) await direct.deleteTend(t.id);
    await direct.bulkTends(tends);
    // Download the result rather than copying it: the server owns the last-done dates.
    await redownload();
    return tends.length;
  }

  return db.transaction('rw', db.tends, db.members, db.wins, db.rooms, async () => {
    if (opts.replace) {
      await db.tends.clear();
      await db.wins.clear();
    }
    await db.members.bulkAdd(newMembers);
    await db.rooms.bulkAdd(newRooms);
    if (opts.mockDates) {
      const mocked = mockHistory(tends, rooms, members, Date.now(), newId);
      tends = mocked.tends;
      await db.wins.bulkAdd(mocked.wins);
    }
    await db.tends.bulkAdd(tends);
    return tends.length;
  });
}

/**
 * Makes the signed-in person a member on this device, using their server id so it lines up with
 * what sync downloads, and selects them. Returns the member id to remember as "me".
 */
export async function adoptServerMember(me: { memberId: string; name: string; animal: string }): Promise<string> {
  // A new user starts on the default sound, as the server does; the next sync brings the real one.
  if (!(await db.members.get(me.memberId))) await db.members.put({ id: me.memberId, name: me.name, animal: me.animal, sound: DEFAULT_SOUND });
  return me.memberId;
}

/** Clears this device's copy. In a connected habitat that's only the copy: it downloads again from the server, once anything queued has reached it. */
export async function resetEverything(): Promise<void> {
  if (isRemote()) await sendQueuedFirst();
  await db.transaction('rw', [db.tends, db.members, db.wins, db.rooms, db.meta, db.outbox, db.gifts], async () => {
    await Promise.all([db.tends.clear(), db.members.clear(), db.wins.clear(), db.rooms.clear(), db.meta.clear(), db.outbox.clear(), db.gifts.clear()]);
  });
  if (isRemote()) await syncNow();
}
