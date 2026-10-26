import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DAY, dayKey, daysBetween, parseDay, startOfWeek } from './dates';
import { parseChoresCsv, tidyText, toChoresCsv } from './csv';
import { mockHistory } from './mock';
import { browse, groupMates, isHandsOff, lastDoneLabel, momentum, ON_DEMAND, pickRandom, quickSet, quickWinsPool, weekSummary } from './selection';
import type { Task, Win } from './types';
import { needOf, needRatio } from './urgency';

const NOW = new Date(2026, 9, 24, 15, 0).getTime(); // Sat 24 Oct 2026, 15:00 local
const daysAgo = (n: number) => NOW - n * DAY;

let seq = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${++seq}`,
  name: `Task ${seq}`,
  room: 'Kitchen',
  tier: 'bee',
  energy: [],
  status: 'active',
  ...over,
});

describe('dates', () => {
  it('counts calendar days, not 24h blocks', () => {
    const lateLastNight = new Date(2026, 9, 23, 23, 30).getTime();
    expect(daysBetween(lateLastNight, NOW)).toBe(1);
  });
  it('parses ISO and UK dates', () => {
    expect(dayKey(parseDay('2026-08-01')!)).toBe('2026-08-01');
    expect(dayKey(parseDay('01/08/2026')!)).toBe('2026-08-01');
    expect(parseDay('soon')).toBeUndefined();
  });
  it('weeks start on Monday', () => {
    expect(new Date(startOfWeek(NOW)).getDay()).toBe(1);
  });
});

describe('urgency', () => {
  it('never-done or unscheduled tasks are not yet known, not overdue', () => {
    expect(needOf(task({ frequencyDays: 7 }), NOW)).toBe('unknown');
    expect(needOf(task({ lastDone: daysAgo(100) }), NOW)).toBe('unknown');
  });
  it('scales by frequency', () => {
    expect(needOf(task({ frequencyDays: 1, lastDone: daysAgo(0) }), NOW)).toBe('resting');
    expect(needOf(task({ frequencyDays: 7, lastDone: daysAgo(5) }), NOW)).toBe('soon');
    expect(needOf(task({ frequencyDays: 1, lastDone: daysAgo(1) }), NOW)).toBe('thirsty');
    expect(needOf(task({ frequencyDays: 30, lastDone: daysAgo(31) }), NOW)).toBe('thirsty');
    expect(needOf(task({ frequencyDays: 1, lastDone: daysAgo(3) }), NOW)).toBe('wilting');
  });
  it('a daily task 3 days late outranks a monthly one a day late', () => {
    const daily = task({ frequencyDays: 1, lastDone: daysAgo(3) });
    const monthly = task({ frequencyDays: 30, lastDone: daysAgo(31) });
    expect(needRatio(daily, NOW)!).toBeGreaterThan(needRatio(monthly, NOW)!);
  });
});

describe('selection', () => {
  const ctx = { now: NOW, memberId: 'alex' };

  it('quick set: the most-needed task of each tier, in tier order', () => {
    const tortoiseTop = task({ tier: 'tortoise', frequencyDays: 1, lastDone: daysAgo(4) });
    const tortoiseNext = task({ tier: 'tortoise', frequencyDays: 7, lastDone: daysAgo(8) });
    const tortoiseSoon = task({ tier: 'tortoise', frequencyDays: 7, lastDone: daysAgo(5) });
    const beeResting = task({ tier: 'bee', frequencyDays: 7, lastDone: daysAgo(1) });
    const beeUnknown = task({ tier: 'bee', frequencyDays: 7 });
    const elephant = task({ tier: 'elephant', frequencyDays: 30, lastDone: daysAgo(31) });
    const sloth = task({ tier: 'sloth', frequencyDays: 2, lastDone: daysAgo(3) });
    const all = [tortoiseNext, beeResting, beeUnknown, elephant, tortoiseTop, tortoiseSoon, sloth];
    expect(quickSet(all, ctx).map((t) => t.id)).toEqual([sloth.id, tortoiseTop.id, elephant.id]);
  });

  it('quick set: "different set" steps each tier along and wraps', () => {
    const t1 = task({ tier: 'tortoise', frequencyDays: 1, lastDone: daysAgo(4) });
    const t2 = task({ tier: 'tortoise', frequencyDays: 1, lastDone: daysAgo(2) });
    const e1 = task({ tier: 'elephant', frequencyDays: 1, lastDone: daysAgo(2) });
    expect(quickSet([t1, t2, e1], ctx, 1).map((t) => t.id)).toEqual([t2.id, e1.id]);
    expect(quickSet([t1, t2, e1], ctx, 2).map((t) => t.id)).toEqual([t1.id, e1.id]);
  });

  it('last done label', () => {
    expect(lastDoneLabel(task(), NOW)).toBeUndefined();
    expect(lastDoneLabel(task({ lastDone: NOW - 1000 }), NOW)).toBe('today');
    expect(lastDoneLabel(task({ lastDone: daysAgo(1) }), NOW)).toBe('yesterday');
    expect(lastDoneLabel(task({ lastDone: daysAgo(5) }), NOW)).toBe('5 days ago');
  });

  it("other people's zones and today's claims are hands off", () => {
    const owned = task({ ownerId: 'robin', frequencyDays: 1, lastDone: daysAgo(2) });
    const claimed = task({ claim: { memberId: 'robin', day: dayKey(NOW) }, frequencyDays: 1, lastDone: daysAgo(2) });
    const staleClaim = task({ claim: { memberId: 'robin', day: '2026-10-23' }, frequencyDays: 1, lastDone: daysAgo(2) });
    const mine = task({ ownerId: 'alex', frequencyDays: 1, lastDone: daysAgo(2) });
    expect(isHandsOff(owned, ctx)).toBe(true);
    expect(isHandsOff(claimed, ctx)).toBe(true);
    expect(isHandsOff(staleClaim, ctx)).toBe(false);
    const visible = quickSet([owned, claimed, staleClaim], ctx).map((t) => t.id);
    expect(visible).toEqual([staleClaim.id]);
    expect(quickSet([owned, mine], ctx).map((t) => t.id)).toEqual([mine.id]);
  });

  it('quick wins: low effort or easy-energy, not resting', () => {
    const sloth = task({ tier: 'sloth', frequencyDays: 7 });
    const brainlessBee = task({ tier: 'bee', energy: ['brainless'], frequencyDays: 1, lastDone: daysAgo(1) });
    const bee = task({ tier: 'bee', frequencyDays: 1, lastDone: daysAgo(1) });
    const restingTortoise = task({ tier: 'tortoise', frequencyDays: 30, lastDone: daysAgo(2) });
    expect(quickWinsPool([sloth, brainlessBee, bee, restingTortoise], ctx).map((t) => t.id)).toEqual([sloth.id, brainlessBee.id]);
  });

  it('pickRandom avoids repeating the current card when it can', () => {
    const pool = [task(), task()];
    expect(pickRandom(pool, pool[0].id, () => 0)!.id).toBe(pool[1].id);
    expect(pickRandom([pool[0]], pool[0].id)!.id).toBe(pool[0].id);
  });

  it('browse shows the whole master list, most needed first, including just-done tasks', () => {
    const sink = task({ name: 'Deep clean sink', energy: ['sensory'], frequencyDays: 14, lastDone: daysAgo(20) });
    const bath = task({ name: 'Clean bath', room: 'Bathroom', frequencyDays: 7, lastDone: daysAgo(8) });
    const justDone = task({ name: 'Laundry', frequencyDays: 3, lastDone: NOW - 1000 });
    const tip = task({ name: 'Go to tip', room: 'General', status: 'onDemand' });
    const paused = task({ name: 'Paused sink job', status: 'paused' });
    const all = [justDone, sink, bath, tip, paused];
    expect(browse(all, ctx, { room: 'Kitchen' }).map((t) => t.id)).toEqual([sink.id, justDone.id]);
    expect(browse(all, ctx, { query: 'sink' }).map((t) => t.id)).toEqual([sink.id]);
    expect(browse(all, ctx, { query: 'tip' }).map((t) => t.id)).toEqual([tip.id]);
    expect(browse(all, ctx, { energy: ['sensory'] }).map((t) => t.id)).toEqual([sink.id]);
    expect(browse(all, ctx, { room: ON_DEMAND }).map((t) => t.id)).toEqual([tip.id]);
    expect(browse(all, ctx, { room: 'General' })).toEqual([]);
  });

  it('group mates: same group, case-insensitive, skipping done and hands-off', () => {
    const kitchen = task({ group: 'Empty Bins' });
    const bath = task({ group: 'empty bins', room: 'Bathroom' });
    const done = task({ group: 'Empty Bins', lastDone: NOW - 1000 });
    const owned = task({ group: 'Empty Bins', ownerId: 'robin' });
    const other = task({ group: 'Hoover' });
    expect(groupMates([kitchen, bath, done, owned, other], kitchen, ctx).map((t) => t.id)).toEqual([bath.id]);
  });

  it('team summary has no per-person counts', () => {
    const w = (memberId: string, room: string, at: number): Win => ({ id: `${at}`, taskId: 'x', taskName: 'x', room, memberId, at });
    const wins = [w('a', 'Kitchen', NOW - 1000), w('b', 'Kitchen', NOW - 2000), w('a', 'Garden', daysAgo(3)), w('c', 'Garden', daysAgo(30))];
    expect(weekSummary(wins, NOW)).toEqual({ total: 3, helpers: 2, rooms: [['Kitchen', 2], ['Garden', 1]] });
    wins[0].helperIds = ['d'];
    expect(weekSummary(wins, NOW).helpers).toBe(3);
    expect(momentum(wins, NOW)).toBe(2);
  });
});

describe('csv import', () => {
  it('tidies spellings and merges case variants', () => {
    expect(tidyText('  Sweep  / Hoover ')).toBe('Sweep/Hoover');
    const csv = [
      'Chore Name,Room,Chore Group,Effort Tier,Frequency (Days),Task status',
      'Clean Window,Kitchen,Clean Window,🐘 Elephant Tier,60,Active',
      'Clean window,Bedroom 1,Clean window,🐘 Elephant Tier,60,Active',
      'Sweep / hoover,Hall,,🐢 Tortoise Tier,7,Active',
      'Sweep/Hoover,Kitchen,,🐢 Tortoise Tier,7,Active',
    ].join('\n');
    const { tasks } = parseChoresCsv(csv);
    expect(tasks.map((t) => t.name)).toEqual(['Clean Window', 'Clean Window', 'Sweep/hoover', 'Sweep/hoover']);
    expect(new Set(tasks.map((t) => t.group).filter(Boolean))).toEqual(new Set(['Clean Window']));
  });

  it('maps statuses, tiers, energy and owners', () => {
    const csv = [
      'Chore Name,Room,Effort Tier,Energy Type,Frequency (Days),Last Done Date,Permanent Owner,Task status',
      'Go to tip,General,🐘 Elephant Tier,,,,,On Demand',
      'Plant bulbs,Garden,🦍 Silverback Tier,,365,,,Paused',
      'General tidy,Kitchen,🐝 Worker Bee Tier,,,,,Done',
      'Wipe tap,Kitchen,🦥 Sloth Tier,"Micro-Steps, Brainless",1,20/10/2026,Robin,Active',
      'Odd one,Kitchen,Mystery,,1,,,Active',
    ].join('\n');
    const { tasks, warnings } = parseChoresCsv(csv);
    expect(tasks.map((t) => t.status)).toEqual(['onDemand', 'paused', 'onDemand', 'active', 'active']);
    expect(tasks[1].tier).toBe('elephant');
    expect(tasks[3]).toMatchObject({ tier: 'sloth', energy: ['micro', 'brainless'], ownerName: 'Robin', frequencyDays: 1 });
    expect(dayKey(tasks[3].lastDone!)).toBe('2026-10-20');
    expect(tasks[4].tier).toBe('bee');
    expect(warnings.some((w) => w.includes('Odd one'))).toBe(true);
  });

  it('reads the example household file', () => {
    const text = readFileSync(new URL('../../public/sample-chores.csv', import.meta.url), 'utf8');
    const { tasks } = parseChoresCsv(text);
    expect(tasks.length).toBeGreaterThan(200);
    expect(tasks.filter((t) => t.status === 'onDemand').length).toBeGreaterThan(50);
    expect(new Set(tasks.map((t) => t.ownerName).filter(Boolean))).toEqual(new Set(['Robin', 'Sam']));
  });

  it('round-trips through export', () => {
    const t = task({ name: 'Feed birds', room: 'Garden', group: 'Birds', tier: 'tortoise', energy: ['transition'], frequencyDays: 2, ownerId: 'm1', lastDone: daysAgo(1) });
    const back = parseChoresCsv(toChoresCsv([t], [{ id: 'm1', name: 'Alex', animal: '🦊' }])).tasks[0];
    expect(back).toMatchObject({ name: 'Feed birds', room: 'Garden', group: 'Birds', tier: 'tortoise', energy: ['transition'], frequencyDays: 2, ownerName: 'Alex', status: 'active' });
  });
});

describe('mock history', () => {
  it('only dates scheduled active tasks, never in the future, with wins for the last week', () => {
    let n = 0;
    const tasks = [task({ frequencyDays: 7 }), task({ status: 'onDemand' }), task({ frequencyDays: 365 })];
    const members = [{ id: 'm', name: 'Alex', animal: '🦊' }];
    const out = mockHistory(tasks, members, NOW, () => `w${++n}`, () => 0.2);
    expect(out.tasks[1].lastDone).toBeUndefined();
    expect(out.tasks.every((t) => t.lastDone == null || t.lastDone <= NOW)).toBe(true);
    expect(out.wins.map((w) => w.taskId)).toEqual([tasks[0].id]);
  });
});
