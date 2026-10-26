import { DAY, HOUR, startOfDay } from './dates';
import type { Member, Room, Tend, Win } from './types';

/**
 * Gives scheduled tends plausible last-done dates (anywhere from just done to well overdue)
 * and back-fills a Win for everything done in the last week, so every screen has something to show.
 */
export function mockHistory(
  tends: Tend[],
  rooms: Room[],
  members: Member[],
  now: number,
  newId: () => string,
  rnd = Math.random,
): { tends: Tend[]; wins: Win[] } {
  const wins: Win[] = [];
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const today = startOfDay(now);
  // Keep today's pretend wins in waking hours where possible.
  const wake = Math.min(today + 7 * HOUR, now);
  const out = tends.map((t) => {
    if (!t.frequencyDays || t.status !== 'active') return t;
    const daysAgo = Math.floor(rnd() * t.frequencyDays * 1.8);
    const at =
      daysAgo === 0
        ? wake + rnd() * (now - wake)
        : Math.min(now, today - daysAgo * DAY + (8 + rnd() * 13) * HOUR);
    if (daysAgo <= 6 && members.length) {
      const owner = members.find((m) => m.id === t.ownerId);
      const member = owner ?? members[Math.floor(rnd() * members.length)];
      wins.push({ id: newId(), tendId: t.id, tendName: t.name, roomId: t.roomId, room: roomName.get(t.roomId) ?? '', memberId: member.id, at });
    }
    return { ...t, lastDone: at };
  });
  return { tends: out, wins };
}
