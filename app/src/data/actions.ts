import { dayKey } from '../domain/dates';
import { type ParsedTend } from '../domain/csv';
import { mockHistory } from '../domain/mock';
import { ANIMALS, byRoomOrder, type DistributiveOmit, type Member, type Room, type Tend, type Win } from '../domain/types';
import { db, newId } from './db';

/**
 * Logs a win per tend, credited to the first member with the rest tagged as helpers.
 * `at` may be backdated ("forgot to tick it off"); lastDone only ever moves forward.
 * Doing an open quest finishes it: it moves to the Completed shelf.
 * Returns the win ids so the toast can undo them.
 */
export async function completeTends(tendIds: string[], memberIds: string[], at = Date.now()): Promise<string[]> {
  const [memberId, ...helperIds] = memberIds;
  return db.transaction('rw', db.tends, db.wins, db.rooms, async () => {
    const ids: string[] = [];
    for (const tend of await db.tends.bulkGet(tendIds)) {
      if (!tend) continue;
      const finishesQuest = tend.kind === 'quest' && tend.completedAt == null;
      const room = (await db.rooms.get(tend.roomId))?.name ?? '';
      const win: Win = { id: newId(), tendId: tend.id, tendName: tend.name, roomId: tend.roomId, room, memberId, at, prevLastDone: tend.lastDone };
      if (helperIds.length) win.helperIds = helperIds;
      if (finishesQuest) win.completedQuest = true;
      await db.wins.add(win);
      if (finishesQuest) await db.tends.update(tend.id, { completedAt: at, claim: undefined });
      if (tend.lastDone == null || at > tend.lastDone) {
        await db.tends.update(tend.id, { lastDone: at, ...(dayKey(at) === dayKey(Date.now()) && { claim: undefined }) });
      }
      ids.push(win.id);
    }
    return ids;
  });
}

export async function undoWins(winIds: string[]): Promise<void> {
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
  await db.tends.update(tendId, { claim: { memberId, day: dayKey(Date.now()) } });
}

/** Fields every tend has. Kind-specific changes go through saveTend, setFrequency or restartQuest. */
export type CommonTendFields = Pick<Tend, 'name' | 'roomId' | 'group' | 'description' | 'tier' | 'impact' | 'energy' | 'status' | 'ownerId'>;

export async function updateTend(id: string, patch: Partial<CommonTendFields>): Promise<void> {
  await db.tends.update(id, patch);
}

/** Habits only: how often it comes back. */
export async function setFrequency(id: string, frequencyDays: number): Promise<void> {
  const tend = await db.tends.get(id);
  if (tend?.kind !== 'habit') throw new Error('Only habits have a frequency.');
  await db.tends.update(id, { frequencyDays });
}

/** Takes a quest off the Completed shelf so it can be done again. */
export async function restartQuest(id: string): Promise<void> {
  const tend = await db.tends.get(id);
  if (tend?.kind !== 'quest') throw new Error('Only quests can be restarted.');
  await db.tends.update(id, { completedAt: undefined });
}

export async function releaseClaim(tendId: string): Promise<void> {
  await db.tends.update(tendId, { claim: undefined });
}

/** Creates or fully replaces a tend (the editor, including switching between habit and quest). */
export async function saveTend(tend: DistributiveOmit<Tend, 'id'> & { id?: string }): Promise<void> {
  await db.tends.put({ ...tend, id: tend.id ?? newId() } as Tend);
}

export async function deleteTend(id: string): Promise<void> {
  await db.tends.delete(id);
}

/** Adds or updates a room. Names are unique in the habitat (ignoring case). */
export async function saveRoom(room: Omit<Room, 'id' | 'sortOrder'> & { id?: string; sortOrder?: number }): Promise<string> {
  const name = room.name.trim();
  if (!name || name.length > 40) throw new Error('A room needs a name of up to 40 characters.');
  return db.transaction('rw', db.rooms, async () => {
    const all = await db.rooms.toArray();
    if (all.some((r) => r.id !== room.id && r.name.toLowerCase() === name.toLowerCase())) throw new Error(`There's already a room called “${name}”.`);
    const id = room.id ?? newId();
    const sortOrder = room.sortOrder ?? all.find((r) => r.id === id)?.sortOrder ?? Math.max(-1, ...all.map((r) => r.sortOrder)) + 1;
    await db.rooms.put({ id, name, sortOrder, ...(room.icon?.trim() && { icon: room.icon.trim() }) });
    return id;
  });
}

/** Removes a room, but only once it's empty, so no habit or quest is ever left without one. */
export async function deleteRoom(id: string): Promise<void> {
  await db.transaction('rw', db.rooms, db.tends, async () => {
    const inUse = await db.tends.where('roomId').equals(id).count();
    if (inUse) throw new Error(`Move or remove its ${inUse} habits and quests first.`);
    await db.rooms.delete(id);
  });
}

/** Swaps a room with its neighbour in the list (-1 = up, +1 = down). */
export async function moveRoom(id: string, direction: -1 | 1): Promise<void> {
  await db.transaction('rw', db.rooms, async () => {
    const rooms = (await db.rooms.toArray()).sort(byRoomOrder);
    const i = rooms.findIndex((r) => r.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= rooms.length) return;
    // Renumber the whole list so ties and gaps from older data can't make the swap a no-op.
    [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
    await db.rooms.bulkPut(rooms.map((r, n) => ({ ...r, sortOrder: n })));
  });
}

export async function saveMember(member: Omit<Member, 'id'> & { id?: string }): Promise<string> {
  const id = member.id ?? newId();
  await db.members.put({ ...member, id });
  return id;
}

export async function deleteMember(id: string): Promise<void> {
  await db.transaction('rw', db.members, db.tends, async () => {
    await db.members.delete(id);
    await db.tends.filter((t) => t.ownerId === id).modify((t) => void delete t.ownerId);
  });
}

export interface ImportOptions {
  replace: boolean;
  mockDates: boolean;
}

/** Imports parsed rows, creating members for any owners named in the file. */
export async function importTends(parsed: ParsedTend[], opts: ImportOptions): Promise<number> {
  return db.transaction('rw', db.tends, db.members, db.wins, db.rooms, async () => {
    if (opts.replace) {
      await db.tends.clear();
      await db.wins.clear();
    }
    const members = await db.members.toArray();
    const byName = new Map(members.map((m) => [m.name.toLowerCase(), m]));
    for (const p of parsed) {
      if (!p.ownerName || byName.has(p.ownerName.toLowerCase())) continue;
      const m: Member = { id: newId(), name: p.ownerName, animal: ANIMALS[members.length % ANIMALS.length] };
      members.push(m);
      byName.set(m.name.toLowerCase(), m);
      await db.members.add(m);
    }

    // Rooms are matched by name (ignoring case); new names become new rooms, in the order the file lists them.
    const rooms = await db.rooms.toArray();
    const roomByName = new Map(rooms.map((r) => [r.name.toLowerCase(), r]));
    let nextOrder = Math.max(-1, ...rooms.map((r) => r.sortOrder)) + 1;
    for (const p of parsed) {
      if (roomByName.has(p.roomName.toLowerCase())) continue;
      const room: Room = { id: newId(), name: p.roomName, sortOrder: nextOrder++ };
      rooms.push(room);
      roomByName.set(room.name.toLowerCase(), room);
      await db.rooms.add(room);
    }

    const now = Date.now();
    let tends: Tend[] = parsed.map(({ ownerName, completed, roomName, ...rest }) => {
      const ownerId = ownerName ? byName.get(ownerName.toLowerCase())?.id : undefined;
      const roomId = roomByName.get(roomName.toLowerCase())!.id;
      return rest.kind === 'quest'
        ? { ...rest, id: newId(), roomId, ownerId, ...(completed && { completedAt: rest.lastDone ?? now }) }
        : { ...rest, id: newId(), roomId, ownerId };
    });
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
 * Makes the signed-in person a member on this device, using their server id so it lines up when
 * sync arrives, and selects them. Returns the member id to remember as "me".
 */
export async function adoptServerMember(me: { memberId: string; name: string; animal: string }): Promise<string> {
  if (!(await db.members.get(me.memberId))) await db.members.put({ id: me.memberId, name: me.name, animal: me.animal });
  return me.memberId;
}

export async function resetEverything(): Promise<void> {
  await db.transaction('rw', db.tends, db.members, db.wins, db.rooms, async () => {
    await Promise.all([db.tends.clear(), db.members.clear(), db.wins.clear(), db.rooms.clear()]);
  });
}
