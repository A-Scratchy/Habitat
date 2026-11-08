import { describe, expect, it } from 'vitest';
import { DAY } from './dates';
import { comparison, packReport, periodStart, shareReport, shiftPeriod } from './report';
import type { EffortTier, Habit, Member, Room, Win } from './types';

const NOW = new Date(2026, 10, 11, 15, 0).getTime(); // Wed 11 Nov 2026, 15:00 local
const daysAgo = (n: number) => NOW - n * DAY;

const rooms: Room[] = [
  { id: 'kitchen', name: 'Kitchen', sortOrder: 0 },
  { id: 'garden', name: 'Garden', sortOrder: 1 },
  { id: 'hall', name: 'Hall', sortOrder: 2 },
];
const members: Member[] = [
  { id: 'sam', name: 'Sam', animal: '🦉', sound: 'chime' },
  { id: 'alex', name: 'Alex', animal: '🦊', sound: 'chime' },
];
const habit = (id: string, roomId: string, over: Partial<Habit> = {}): Habit =>
  ({ id, name: id, roomId, tier: 'bee', impact: 'medium', energy: [], status: 'active', kind: 'habit', schedule: 'every', frequencyDays: 7, ...over }) as Habit;
const tends = [habit('wipe', 'kitchen'), habit('mow', 'garden'), habit('spills', 'kitchen', { schedule: 'whenNeeded', frequencyDays: undefined }), habit('mop', 'hall')];

let n = 0;
const win = (tendId: string, roomId: string | undefined, tier: EffortTier, at: number, memberId = 'alex', helperIds?: string[]): Win => ({
  id: `w${++n}`,
  tendId,
  tendName: tendId,
  ...(roomId && { roomId }),
  tier,
  memberId,
  ...(helperIds && { helperIds }),
  at,
});

describe('report periods', () => {
  it('weeks start on Monday and months on the 1st', () => {
    expect(new Date(periodStart('week', NOW)).getDate()).toBe(9);
    expect(new Date(periodStart('month', NOW)).getDate()).toBe(1);
    expect(new Date(shiftPeriod('month', periodStart('month', NOW), -1)).getMonth()).toBe(9);
  });
});

describe('pack report', () => {
  const wins = [
    win('wipe', 'kitchen', 'sloth', NOW - 1000),
    win('spills', 'kitchen', 'tortoise', NOW - 2000),
    win('mow', 'garden', 'elephant', daysAgo(1)),
    // Last week, before and after this point in the week.
    win('wipe', 'kitchen', 'bee', daysAgo(7) - 1000),
    win('mow', 'garden', 'elephant', daysAgo(6) + 1000),
    // Out and about, no room.
    win('tip', undefined, 'bee', daysAgo(2)),
  ];

  it('weights effort by tier, splits by room and tier, and finds quiet rooms', () => {
    const r = packReport(wins, tends, rooms, 'week', NOW);
    // 1 + 2 + 5 + 3
    expect([r.acorns, r.done]).toEqual([11, 4]);
    expect(r.rooms.map((x) => [x.name, x.acorns])).toEqual([
      ['Garden', 5],
      ['Kitchen', 3],
      ['Out and about', 3],
    ]);
    expect(r.tiers.find((t) => t.tier === 'elephant')).toEqual({ tier: 'elephant', acorns: 5, done: 1 });
    expect(r.whenNeeded).toBe(1);
    expect(r.quiet.map((x) => x.name)).toEqual(['Hall']);
  });

  it('compares with the same point last week, not the whole of it', () => {
    const r = packReport(wins, tends, rooms, 'week', NOW);
    expect(r.before).toEqual({ acorns: 3, done: 1 });
    expect(comparison(r)).toMatch(/^More than/);
  });

  it('has one bar per recent period, the last being now', () => {
    const r = packReport(wins, tends, rooms, 'day', NOW);
    expect(r.bars).toHaveLength(7);
    expect(r.bars.at(-1)).toMatchObject({ current: true, acorns: 3, done: 2 });
    expect(r.bars.at(-2)).toMatchObject({ current: false, acorns: 5 });
  });

  it('is kind about a quiet spell', () => {
    expect(comparison(packReport([], tends, rooms, 'month', NOW))).toMatch(/Rest counts/);
  });
});

describe('share of the load', () => {
  it('splits shared jobs, lists everyone in name order, and tracks one person over time', () => {
    const wins = [win('mow', 'garden', 'elephant', NOW - 1000, 'alex', ['sam']), win('wipe', 'kitchen', 'bee', NOW - 2000, 'sam'), win('wipe', 'kitchen', 'bee', daysAgo(7), 'alex')];
    const r = shareReport(wins, members, 'alex', 'week', NOW);
    expect(r.total).toBe(8);
    expect(r.members.map((m) => [m.member.name, m.acorns, m.done])).toEqual([
      ['Alex', 2.5, 1],
      ['Sam', 5.5, 2],
    ]);
    expect(r.trend.at(-1)?.share).toBeCloseTo(2.5 / 8);
    expect(r.trend.at(-2)?.share).toBe(1);
    expect(r.trend[0].share).toBeUndefined();
  });
});
