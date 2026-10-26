import { dayKey } from '../domain/dates';
import { type ParsedTask } from '../domain/csv';
import { mockHistory } from '../domain/mock';
import { ANIMALS, type Member, type Task, type Win } from '../domain/types';
import { db, newId } from './db';

/**
 * Logs a win per task, credited to the first member with the rest tagged as helpers.
 * `at` may be backdated ("forgot to tick it off"); lastDone only ever moves forward.
 * Returns the win ids so the toast can undo them.
 */
export async function completeTasks(taskIds: string[], memberIds: string[], at = Date.now()): Promise<string[]> {
  const [memberId, ...helperIds] = memberIds;
  return db.transaction('rw', db.tasks, db.wins, async () => {
    const ids: string[] = [];
    for (const task of await db.tasks.bulkGet(taskIds)) {
      if (!task) continue;
      const win: Win = { id: newId(), taskId: task.id, taskName: task.name, room: task.room, memberId, at, prevLastDone: task.lastDone };
      if (helperIds.length) win.helperIds = helperIds;
      await db.wins.add(win);
      if (task.lastDone == null || at > task.lastDone) {
        await db.tasks.update(task.id, { lastDone: at, ...(dayKey(at) === dayKey(Date.now()) && { claim: undefined }) });
      }
      ids.push(win.id);
    }
    return ids;
  });
}

export async function undoWins(winIds: string[]): Promise<void> {
  await db.transaction('rw', db.tasks, db.wins, async () => {
    for (const win of await db.wins.bulkGet(winIds)) {
      if (!win) continue;
      const task = await db.tasks.get(win.taskId);
      // Only roll back if nothing newer has been logged since.
      if (task && task.lastDone === win.at) await db.tasks.update(task.id, { lastDone: win.prevLastDone });
      await db.wins.delete(win.id);
    }
  });
}

export async function claimToday(taskId: string, memberId: string): Promise<void> {
  await db.tasks.update(taskId, { claim: { memberId, day: dayKey(Date.now()) } });
}

export async function updateTask(id: string, patch: Partial<Omit<Task, 'id'>>): Promise<void> {
  await db.tasks.update(id, patch);
}

export async function releaseClaim(taskId: string): Promise<void> {
  await db.tasks.update(taskId, { claim: undefined });
}

export async function saveTask(task: Omit<Task, 'id'> & { id?: string }): Promise<void> {
  await db.tasks.put({ ...task, id: task.id ?? newId() });
}

export async function deleteTask(id: string): Promise<void> {
  await db.tasks.delete(id);
}

export async function saveMember(member: Omit<Member, 'id'> & { id?: string }): Promise<string> {
  const id = member.id ?? newId();
  await db.members.put({ ...member, id });
  return id;
}

export async function deleteMember(id: string): Promise<void> {
  await db.transaction('rw', db.members, db.tasks, async () => {
    await db.members.delete(id);
    await db.tasks.filter((t) => t.ownerId === id).modify((t) => void delete t.ownerId);
  });
}

export interface ImportOptions {
  replace: boolean;
  mockDates: boolean;
}

/** Imports parsed rows, creating members for any owners named in the file. */
export async function importTasks(parsed: ParsedTask[], opts: ImportOptions): Promise<number> {
  return db.transaction('rw', db.tasks, db.members, db.wins, async () => {
    if (opts.replace) {
      await db.tasks.clear();
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

    let tasks: Task[] = parsed.map(({ ownerName, ...rest }) => ({
      ...rest,
      id: newId(),
      ownerId: ownerName ? byName.get(ownerName.toLowerCase())?.id : undefined,
    }));
    if (opts.mockDates) {
      const mocked = mockHistory(tasks, members, Date.now(), newId);
      tasks = mocked.tasks;
      await db.wins.bulkAdd(mocked.wins);
    }
    await db.tasks.bulkAdd(tasks);
    return tasks.length;
  });
}

export async function resetEverything(): Promise<void> {
  await db.transaction('rw', db.tasks, db.members, db.wins, async () => {
    await Promise.all([db.tasks.clear(), db.members.clear(), db.wins.clear()]);
  });
}
