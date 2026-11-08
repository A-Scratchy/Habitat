import { DAY, HOUR, startOfDay } from './dates';
import type { Member, Room, Tend, Win } from './types';

/**
 * Gives scheduled tends plausible last-done dates (anywhere from just done to well overdue)
 * and back-fills Wins going back about six months, so every screen (reports included) has something to show.
 */
const HISTORY_DAYS = 180;

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
    if (t.kind !== 'habit' || t.schedule !== 'every' || t.status !== 'active') return t;
    const daysAgo = Math.floor(rnd() * t.frequencyDays * 1.8);
    const at =
      daysAgo === 0
        ? wake + rnd() * (now - wake)
        : Math.min(now, today - daysAgo * DAY + (8 + rnd() * 13) * HOUR);
    if (members.length) {
      const owner = members.find((m) => m.id === t.ownerId);
      const room = t.roomId ? { roomId: t.roomId, room: roomName.get(t.roomId) } : {};
      // The last one, then earlier ones about every so often, so reports have months to show.
      for (let when = at; when >= now - HISTORY_DAYS * DAY; when -= t.frequencyDays * DAY * (0.7 + rnd() * 0.9)) {
        const member = owner ?? members[Math.floor(rnd() * members.length)];
        wins.push({ id: newId(), tendId: t.id, tendName: t.name, ...room, tier: t.tier, memberId: member.id, at: Math.round(when) });
      }
    }
    return { ...t, lastDone: at };
  });
  return { tends: out, wins };
}
