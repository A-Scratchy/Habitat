import { DAY, HOUR, startOfDay } from './dates';
import type { Member, Task, Win } from './types';

/**
 * Gives scheduled tasks plausible last-done dates (anywhere from just done to well overdue)
 * and back-fills a Win for everything done in the last week, so every screen has something to show.
 */
export function mockHistory(
  tasks: Task[],
  members: Member[],
  now: number,
  newId: () => string,
  rnd = Math.random,
): { tasks: Task[]; wins: Win[] } {
  const wins: Win[] = [];
  const today = startOfDay(now);
  // Keep today's pretend wins in waking hours where possible.
  const wake = Math.min(today + 7 * HOUR, now);
  const out = tasks.map((t) => {
    if (!t.frequencyDays || t.status !== 'active') return t;
    const daysAgo = Math.floor(rnd() * t.frequencyDays * 1.8);
    const at =
      daysAgo === 0
        ? wake + rnd() * (now - wake)
        : Math.min(now, today - daysAgo * DAY + (8 + rnd() * 13) * HOUR);
    if (daysAgo <= 6 && members.length) {
      const owner = members.find((m) => m.id === t.ownerId);
      const member = owner ?? members[Math.floor(rnd() * members.length)];
      wins.push({ id: newId(), taskId: t.id, taskName: t.name, room: t.room, memberId: member.id, at });
    }
    return { ...t, lastDone: at };
  });
  return { tasks: out, wins };
}
