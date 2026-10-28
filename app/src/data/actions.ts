import { dayKey } from '../domain/dates';
import { type ParsedTend } from '../domain/csv';
import { mockHistory } from '../domain/mock';
import { ANIMALS, byRoomOrder, DEFAULT_SOUND, type DistributiveOmit, type Member, type Room, type Tend, type Win } from '../domain/types';
import { userToken } from '../auth/entra';
import { db, newId } from './db';
import { isRemote, redownload, server, syncNow } from './remote';

/*
 * In a connected habitat each change goes to the server first; only once it's accepted is it copied
 * into this device's database (so the screens update straight away), followed by a background pull
 * for anything the server worked out itself. Server calls never happen inside a local transaction:
 * IndexedDB transactions close as soon as they wait on anything else.
 */

/** After a change the server accepted: fetch what it decided (last-done dates, claims) without waiting. */
const refresh = () => void syncNow();

/**
 * Logs a win per tend, credited to the first member with the rest tagged as helpers.
 * `at` may be backdated ("forgot to tick it off"); lastDone only ever moves forward.
 * Doing an open quest finishes it: it moves to the Completed shelf.
 * Returns the win ids so the toast can undo them.
 */
export async function completeTends(tendIds: string[], memberIds: string[], at = Date.now()): Promise<string[]> {
  const [memberId, ...helperIds] = memberIds;
  const found = (await db.tends.bulkGet(tendIds)).filter((t): t is Tend => !!t);
  const winIds = new Map(found.map((t) => [t.id, newId()]));
  if (isRemote()) {
    for (const t of found) await server.putWin(winIds.get(t.id)!, t.id, memberIds, at);
  }
  const ids = await db.transaction('rw', db.tends, db.wins, db.rooms, async () => {
    const ids: string[] = [];
    for (const tend of await db.tends.bulkGet(found.map((t) => t.id))) {
      if (!tend) continue;
      const finishesQuest = tend.kind === 'quest' && tend.completedAt == null;
      const room = tend.roomId ? (await db.rooms.get(tend.roomId))?.name : undefined;
      const win: Win = { id: winIds.get(tend.id)!, tendId: tend.id, tendName: tend.name, ...(tend.roomId && { roomId: tend.roomId, room }), memberId, at, prevLastDone: tend.lastDone };
      if (helperIds.length) win.helperIds = helperIds;
      if (finishesQuest) win.completedQuest = true;
      await db.wins.put(win);
      if (finishesQuest) await db.tends.update(tend.id, { completedAt: at, claim: undefined });
      if (tend.lastDone == null || at > tend.lastDone) {
        await db.tends.update(tend.id, { lastDone: at, ...(dayKey(at) === dayKey(Date.now()) && { claim: undefined }) });
      }
      ids.push(win.id);
    }
    return ids;
  });
  if (isRemote()) refresh();
  return ids;
}

export async function undoWins(winIds: string[]): Promise<void> {
  if (isRemote()) {
    // The server works out the right last-done date from the wins that are left; wait for it.
    for (const id of winIds) await server.deleteWin(id);
    await db.wins.bulkDelete(winIds);
    await syncNow();
    return;
  }
  await db.transaction('rw', db.tends, db.wins, async () => {
    for (const win of await db.wins.bulkGet(winIds)) {
      if (!win) continue;
      const tend = await db.tends.get(win.tendId);
      // Only roll back if nothing newer has been logged since.
      if (tend && tend.lastDone === win.at) await db.tends.update(tend.id, { lastDone: win.prevLastDone });
      // Undoing the win that finished a quest puts it back on the open list.
      if (tend?.kind === 'quest' && win.completedQuest && tend.completedAt === win.at) await db.tends.update(tend.id, { completedAt: undefined });
      await db.wins.delete(win.id);
    }
  });
}

export async function claimToday(tendId: string, memberId: string): Promise<void> {
  if (isRemote()) await server.claim(tendId, memberId);
  await db.tends.update(tendId, { claim: { memberId, day: dayKey(Date.now()) } });
  if (isRemote()) refresh();
}

/** Fields every tend has. Kind-specific changes (room, schedule, finishing) go through saveTend, setFrequency or restartQuest. */
export type CommonTendFields = Pick<Tend, 'name' | 'group' | 'description' | 'tier' | 'impact' | 'energy' | 'status'>;

export async function updateTend(id: string, patch: Partial<CommonTendFields>): Promise<void> {
  if (isRemote()) await server.patchTend(id, patch);
  await db.tends.update(id, patch);
}

/** Habits only: how often it comes back. */
export async function setFrequency(id: string, frequencyDays: number): Promise<void> {
  const tend = await db.tends.get(id);
  if (tend?.kind !== 'habit') throw new Error('Only habits have a frequency.');
  if (isRemote()) await server.patchTend(id, { frequencyDays });
  await db.tends.update(id, { frequencyDays });
}

/** Takes a quest off the Completed shelf so it can be done again. */
export async function restartQuest(id: string): Promise<void> {
  const tend = await db.tends.get(id);
  if (tend?.kind !== 'quest') throw new Error('Only quests can be restarted.');
  if (isRemote()) await server.restartQuest(id);
  await db.tends.update(id, { completedAt: undefined });
}

export async function releaseClaim(tendId: string): Promise<void> {
  if (isRemote()) await server.releaseClaim(tendId);
  await db.tends.update(tendId, { claim: undefined });
}

/** Creates or fully replaces a tend (the editor, including switching between habit and quest). */
export async function saveTend(tend: DistributiveOmit<Tend, 'id'> & { id?: string }): Promise<void> {
  const full = { ...tend, id: tend.id ?? newId() } as Tend;
  if (isRemote()) await server.putTend(full);
  await db.tends.put(full);
  // Switching kinds can change what the server keeps (a habit is never finished, for one).
  if (isRemote()) refresh();
}

export async function deleteTend(id: string): Promise<void> {
  if (isRemote()) await server.deleteTend(id);
  await db.tends.delete(id);
}

/** Adds or updates a room. Names are unique in the habitat (ignoring case). */
export async function saveRoom(room: Omit<Room, 'id' | 'sortOrder'> & { id?: string; sortOrder?: number }): Promise<string> {
  const name = room.name.trim();
  if (!name || name.length > 40) throw new Error('A room needs a name of up to 40 characters.');
  const all = await db.rooms.toArray();
  if (all.some((r) => r.id !== room.id && r.name.toLowerCase() === name.toLowerCase())) throw new Error(`There's already a room called “${name}”.`);
  const id = room.id ?? newId();
  const sortOrder = room.sortOrder ?? all.find((r) => r.id === id)?.sortOrder ?? Math.max(-1, ...all.map((r) => r.sortOrder)) + 1;
  const saved: Room = { id, name, sortOrder, ...(room.icon?.trim() && { icon: room.icon.trim() }) };
  if (isRemote()) await server.putRoom(saved);
  await db.rooms.put(saved);
  return id;
}

/** Removes a room, but only once it's empty, so no habit or quest is ever left without one. */
export async function deleteRoom(id: string): Promise<void> {
  const inUse = await db.tends.where('roomId').equals(id).count();
  if (inUse) throw new Error(`Move or remove its ${inUse} habits and quests first.`);
  if (isRemote()) await server.deleteRoom(id);
  await db.rooms.delete(id);
}

/** Swaps a room with its neighbour in the list (-1 = up, +1 = down). */
export async function moveRoom(id: string, direction: -1 | 1): Promise<void> {
  const rooms = (await db.rooms.toArray()).sort(byRoomOrder);
  const i = rooms.findIndex((r) => r.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= rooms.length) return;
  // Renumber the whole list so ties and gaps from older data can't make the swap a no-op.
  [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
  const renumbered = rooms.map((r, n) => ({ ...r, sortOrder: n }));
  if (isRemote()) {
    const changed = renumbered.filter((r) => r.sortOrder !== rooms.find((x) => x.id === r.id)!.sortOrder);
    for (const r of changed) await server.putRoom(r);
  }
  await db.rooms.bulkPut(renumbered);
}

export async function saveMember(member: Omit<Member, 'id'> & { id?: string }): Promise<string> {
  const saved: Member = { ...member, id: member.id ?? newId() };
  if (isRemote()) await server.putMember(saved);
  await db.members.put(saved);
  return saved.id;
}

export async function deleteMember(id: string): Promise<void> {
  if (isRemote()) {
    // Only a signed-in user may remove someone; the server also frees up their habits and quests.
    await server.deleteMember(id, await userToken());
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
    for (const m of newMembers) await server.putMember(m);
    for (const r of newRooms) await server.putRoom(r);
    if (opts.replace) for (const t of await db.tends.toArray()) await server.deleteTend(t.id);
    await server.bulkTends(tends);
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

/** Clears this device's copy. In a connected habitat that's only the copy: it downloads again from the server. */
export async function resetEverything(): Promise<void> {
  await db.transaction('rw', [db.tends, db.members, db.wins, db.rooms, db.meta], async () => {
    await Promise.all([db.tends.clear(), db.members.clear(), db.wins.clear(), db.rooms.clear(), db.meta.clear()]);
  });
  if (isRemote()) await syncNow();
}
