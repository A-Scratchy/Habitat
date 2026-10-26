import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DAY, dayKey, daysBetween, parseDay, startOfWeek } from './dates';
import { parseTendsCsv, tidyText, toTendsCsv } from './csv';
import { mockHistory } from './mock';
import { browse, completedQuests, groupMates, isHandsOff, isOpen, lastDoneLabel, momentum, pickRandom, quickSet, quickWinsPool, weekSummary } from './selection';
import type { Habit, Quest, Win } from './types';
import { needOf, needRatio } from './urgency';

const NOW = new Date(2026, 9, 24, 15, 0).getTime(); // Sat 24 Oct 2026, 15:00 local
const daysAgo = (n: number) => NOW - n * DAY;

let seq = 0;
const base = () => ({ id: `t${++seq}`, name: `Tend ${seq}`, room: 'Kitchen', tier: 'bee' as const, energy: [], status: 'active' as const });
const habit = (over: Partial<Omit<Habit, 'kind'>> = {}): Habit => ({ ...base(), kind: 'habit', frequencyDays: 7, ...over });
const quest = (over: Partial<Omit<Quest, 'kind'>> = {}): Quest => ({ ...base(), kind: 'quest', ...over });

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
  it('never-done habits and all quests are not yet known, not overdue', () => {
    expect(needOf(habit({ frequencyDays: 7 }), NOW)).toBe('unknown');
    expect(needOf(quest({ lastDone: daysAgo(100) }), NOW)).toBe('unknown');
  });
  it('scales by frequency', () => {
    expect(needOf(habit({ frequencyDays: 1, lastDone: daysAgo(0) }), NOW)).toBe('resting');
    expect(needOf(habit({ frequencyDays: 7, lastDone: daysAgo(5) }), NOW)).toBe('soon');
    expect(needOf(habit({ frequencyDays: 1, lastDone: daysAgo(1) }), NOW)).toBe('thirsty');
    expect(needOf(habit({ frequencyDays: 30, lastDone: daysAgo(31) }), NOW)).toBe('thirsty');
    expect(needOf(habit({ frequencyDays: 1, lastDone: daysAgo(3) }), NOW)).toBe('wilting');
  });
  it('a daily habit 3 days late outranks a monthly one a day late', () => {
    const daily = habit({ frequencyDays: 1, lastDone: daysAgo(3) });
    const monthly = habit({ frequencyDays: 30, lastDone: daysAgo(31) });
    expect(needRatio(daily, NOW)!).toBeGreaterThan(needRatio(monthly, NOW)!);
  });
});

describe('selection', () => {
  const ctx = { now: NOW, memberId: 'alex' };

  it('quick set: the most-needed habit of each tier, in tier order', () => {
    const tortoiseTop = habit({ tier: 'tortoise', frequencyDays: 1, lastDone: daysAgo(4) });
    const tortoiseNext = habit({ tier: 'tortoise', frequencyDays: 7, lastDone: daysAgo(8) });
    const tortoiseSoon = habit({ tier: 'tortoise', frequencyDays: 7, lastDone: daysAgo(5) });
    const beeResting = habit({ tier: 'bee', frequencyDays: 7, lastDone: daysAgo(1) });
    const beeUnknown = habit({ tier: 'bee', frequencyDays: 7 });
    const elephant = habit({ tier: 'elephant', frequencyDays: 30, lastDone: daysAgo(31) });
    const sloth = habit({ tier: 'sloth', frequencyDays: 2, lastDone: daysAgo(3) });
    const all = [tortoiseNext, beeResting, beeUnknown, elephant, tortoiseTop, tortoiseSoon, sloth];
    expect(quickSet(all, ctx).map((t) => t.id)).toEqual([sloth.id, tortoiseTop.id, elephant.id]);
  });

  it('quick set: "different set" steps each tier along and wraps', () => {
    const t1 = habit({ tier: 'tortoise', frequencyDays: 1, lastDone: daysAgo(4) });
    const t2 = habit({ tier: 'tortoise', frequencyDays: 1, lastDone: daysAgo(2) });
    const e1 = habit({ tier: 'elephant', frequencyDays: 1, lastDone: daysAgo(2) });
    expect(quickSet([t1, t2, e1], ctx, 1).map((t) => t.id)).toEqual([t2.id, e1.id]);
    expect(quickSet([t1, t2, e1], ctx, 2).map((t) => t.id)).toEqual([t1.id, e1.id]);
  });

  it('daily screens only offer habits, never quests', () => {
    const q = quest({ tier: 'sloth' });
    const h = habit({ tier: 'sloth', frequencyDays: 1, lastDone: daysAgo(2) });
    expect(quickSet([q, h], ctx).map((t) => t.id)).toEqual([h.id]);
    expect(quickWinsPool([q, h], ctx).map((t) => t.id)).toEqual([h.id]);
  });

  it('last done label', () => {
    expect(lastDoneLabel(habit(), NOW)).toBeUndefined();
    expect(lastDoneLabel(habit({ lastDone: NOW - 1000 }), NOW)).toBe('today');
    expect(lastDoneLabel(habit({ lastDone: daysAgo(1) }), NOW)).toBe('yesterday');
    expect(lastDoneLabel(habit({ lastDone: daysAgo(5) }), NOW)).toBe('5 days ago');
  });

  it("other people's zones and today's claims are hands off", () => {
    const owned = habit({ ownerId: 'robin', frequencyDays: 1, lastDone: daysAgo(2) });
    const claimed = habit({ claim: { memberId: 'robin', day: dayKey(NOW) }, frequencyDays: 1, lastDone: daysAgo(2) });
    const staleClaim = habit({ claim: { memberId: 'robin', day: '2026-10-23' }, frequencyDays: 1, lastDone: daysAgo(2) });
    const mine = habit({ ownerId: 'alex', frequencyDays: 1, lastDone: daysAgo(2) });
    expect(isHandsOff(owned, ctx)).toBe(true);
    expect(isHandsOff(claimed, ctx)).toBe(true);
    expect(isHandsOff(staleClaim, ctx)).toBe(false);
    expect(quickSet([owned, claimed, staleClaim], ctx).map((t) => t.id)).toEqual([staleClaim.id]);
    expect(quickSet([owned, mine], ctx).map((t) => t.id)).toEqual([mine.id]);
  });

  it('quick wins: low effort or easy-energy, not resting', () => {
    const sloth = habit({ tier: 'sloth', frequencyDays: 7 });
    const brainlessBee = habit({ tier: 'bee', energy: ['brainless'], frequencyDays: 1, lastDone: daysAgo(1) });
    const bee = habit({ tier: 'bee', frequencyDays: 1, lastDone: daysAgo(1) });
    const restingTortoise = habit({ tier: 'tortoise', frequencyDays: 30, lastDone: daysAgo(2) });
    expect(quickWinsPool([sloth, brainlessBee, bee, restingTortoise], ctx).map((t) => t.id)).toEqual([sloth.id, brainlessBee.id]);
  });

  it('pickRandom avoids repeating the current card when it can', () => {
    const pool = [habit(), habit()];
    expect(pickRandom(pool, pool[0].id, () => 0)!.id).toBe(pool[1].id);
    expect(pickRandom([pool[0]], pool[0].id)!.id).toBe(pool[0].id);
  });

  it('Forage browses open habits, most needed first, including just-done ones', () => {
    const sink = habit({ name: 'Deep clean sink', energy: ['sensory'], frequencyDays: 14, lastDone: daysAgo(20) });
    const bath = habit({ name: 'Clean bath', room: 'Bathroom', frequencyDays: 7, lastDone: daysAgo(8) });
    const justDone = habit({ name: 'Laundry', frequencyDays: 3, lastDone: NOW - 1000 });
    const tip = quest({ name: 'Go to tip', room: 'General' });
    const paused = habit({ name: 'Paused sink job', status: 'paused' });
    const all = [justDone, sink, bath, tip, paused];
    expect(browse(all, ctx, 'habit', { room: 'Kitchen' }).map((t) => t.id)).toEqual([sink.id, justDone.id]);
    expect(browse(all, ctx, 'habit', { query: 'sink' }).map((t) => t.id)).toEqual([sink.id]);
    expect(browse(all, ctx, 'habit', { query: 'tip' })).toEqual([]);
    expect(browse(all, ctx, 'habit', { energy: ['sensory'] }).map((t) => t.id)).toEqual([sink.id]);
  });

  it('Quests browses open quests only; finished ones are on the Completed shelf', () => {
    const tip = quest({ name: 'Go to tip', room: 'General' });
    const mend = quest({ name: 'Mend clothes', description: 'Buttons on the blue coat' });
    const done = quest({ name: 'Sort charity bags', completedAt: daysAgo(2) });
    const doneEarlier = quest({ name: 'Clear loft', completedAt: daysAgo(9) });
    const h = habit({ name: 'Water plants' });
    const all = [tip, mend, done, doneEarlier, h];
    expect(browse(all, ctx, 'quest', {}).map((t) => t.id).sort()).toEqual([mend.id, tip.id].sort());
    expect(browse(all, ctx, 'quest', { query: 'blue coat' }).map((t) => t.id)).toEqual([mend.id]);
    expect(isOpen(done)).toBe(false);
    expect(completedQuests(all).map((t) => t.id)).toEqual([done.id, doneEarlier.id]);
  });

  it('group mates: open habits in the same group, case-insensitive, skipping done and hands-off', () => {
    const kitchen = habit({ group: 'Empty Bins' });
    const bath = habit({ group: 'empty bins', room: 'Bathroom' });
    const done = habit({ group: 'Empty Bins', lastDone: NOW - 1000 });
    const owned = habit({ group: 'Empty Bins', ownerId: 'robin' });
    const aQuest = quest({ group: 'Empty Bins' });
    const other = habit({ group: 'Hoover' });
    expect(groupMates([kitchen, bath, done, owned, aQuest, other], kitchen, ctx).map((t) => t.id)).toEqual([bath.id]);
  });

  it('team summary has no per-person counts', () => {
    const w = (memberId: string, room: string, at: number): Win => ({ id: `${at}`, tendId: 'x', tendName: 'x', room, memberId, at });
    const wins = [w('a', 'Kitchen', NOW - 1000), w('b', 'Kitchen', NOW - 2000), w('a', 'Garden', daysAgo(3)), w('c', 'Garden', daysAgo(30))];
    expect(weekSummary(wins, NOW)).toEqual({ total: 3, helpers: 2, rooms: [['Kitchen', 2], ['Garden', 1]] });
    wins[0].helperIds = ['d'];
    expect(weekSummary(wins, NOW).helpers).toBe(3);
    expect(momentum(wins, NOW)).toBe(2);
  });
});

describe('csv import', () => {
  const HEADER = 'Name,Room,Group,Kind,Description,Effort Tier,Energy Type,Frequency (Days),Last Done Date,Permanent Owner,Status';
  const parse = (...rows: string[]) => parseTendsCsv([HEADER, ...rows].join('\n'));

  it('tidies spellings and merges case variants', () => {
    expect(tidyText('  Sweep  / Hoover ')).toBe('Sweep/Hoover');
    const { tends, errors } = parse(
      'Clean Window,Kitchen,Clean Window,Habit,,🐘 Elephant Tier,,60,,,Active',
      'Clean window,Bedroom 1,Clean window,Habit,,🐘 Elephant Tier,,60,,,Active',
      'Sweep / hoover,Hall,,Habit,,🐢 Tortoise Tier,,7,,,',
      'Sweep/Hoover,Kitchen,,Habit,,🐢 Tortoise Tier,,7,,,',
    );
    expect(errors).toEqual([]);
    expect(tends.map((t) => t.name)).toEqual(['Clean Window', 'Clean Window', 'Sweep/hoover', 'Sweep/hoover']);
    expect(new Set(tends.map((t) => t.group).filter(Boolean))).toEqual(new Set(['Clean Window']));
  });

  it('reads kinds, statuses, tiers, energy, owners and multi-line descriptions', () => {
    const { tends, errors } = parse(
      'Go to tip,General,,Quest,,🐘 Elephant Tier,,,,,Active',
      'Plant bulbs,Garden,,Habit,,🦍 Silverback Tier,,365,,,Paused',
      'Sort charity bags,Hall,,Quest,,🐝 Worker Bee Tier,,,,,Done',
      'Wipe tap,Kitchen,,Habit,"Spray\nWipe\nDry",🦥 Sloth Tier,"Micro-Steps, Brainless",1,20/10/2026,Robin,Active',
    );
    expect(errors).toEqual([]);
    expect(tends.map((t) => [t.kind, t.status])).toEqual([
      ['quest', 'active'],
      ['habit', 'paused'],
      ['quest', 'active'],
      ['habit', 'active'],
    ]);
    expect(tends[1].tier).toBe('elephant');
    expect(tends[2]).toMatchObject({ completed: true });
    expect(tends[3]).toMatchObject({ tier: 'sloth', energy: ['micro', 'brainless'], ownerName: 'Robin', frequencyDays: 1, description: 'Spray\nWipe\nDry' });
    expect(dayKey(tends[3].lastDone!)).toBe('2026-10-20');
  });

  it('never guesses: a missing Kind column stops the import', () => {
    const { tends, errors } = parseTendsCsv('Name,Room,Frequency (Days)\nWipe tap,Kitchen,1');
    expect(tends).toEqual([]);
    expect(errors[0]).toMatch(/Kind/);
  });

  it.each([
    ['Odd,Kitchen,,Chore,,🐝 Worker Bee Tier,,7,,,', /Kind must be Habit or Quest/],
    ['Odd,Kitchen,,Habit,,🐝 Worker Bee Tier,,,,,', /needs a Frequency/],
    ['Odd,Kitchen,,Habit,,🐝 Worker Bee Tier,,0,,,', /needs a Frequency/],
    ['Odd,Kitchen,,Quest,,🐝 Worker Bee Tier,,7,,,', /Quest has no Frequency/],
    ['Odd,Kitchen,,Habit,,Mystery,,7,,,', /Effort Tier must be/],
    ['Odd,Kitchen,,Habit,,🐝 Worker Bee Tier,,7,,,Done', /only Quests can be Done/],
    ['Odd,Kitchen,,Quest,,🐝 Worker Bee Tier,,,,,On Demand', /Status must be/],
    ['Odd,Kitchen,,Quest,,🐝 Worker Bee Tier,,,yesterday,,', /isn't a date/],
  ])('rejects a bad row, names its line, and imports nothing: %s', (row, message) => {
    const { tends, errors } = parse('Fine,Kitchen,,Habit,,🐝 Worker Bee Tier,,7,,,', row);
    expect(tends).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Line 3/);
    expect(errors[0]).toMatch(message);
  });

  it('rejects the same name twice in one room', () => {
    const { errors } = parse('Wipe tap,Kitchen,,Habit,,🐝 Worker Bee Tier,,7,,,', 'Wipe tap,Kitchen,,Habit,,🐝 Worker Bee Tier,,7,,,');
    expect(errors[0]).toMatch(/listed twice/);
  });

  it('reads the example household file', () => {
    const text = readFileSync(new URL('../../public/sample-habitat.csv', import.meta.url), 'utf8');
    const { tends, errors } = parseTendsCsv(text);
    expect(errors).toEqual([]);
    expect(tends.filter((t) => t.kind === 'habit').length).toBe(162);
    expect(tends.filter((t) => t.kind === 'quest').length).toBe(63);
    expect(new Set(tends.map((t) => t.ownerName).filter(Boolean))).toEqual(new Set(['Robin', 'Sam']));
  });

  it('round-trips through export, habits and quests alike', () => {
    const h = habit({ name: 'Feed birds', room: 'Garden', group: 'Birds', tier: 'tortoise', energy: ['transition'], frequencyDays: 2, ownerId: 'm1', lastDone: daysAgo(1), description: 'Seed in the shed' });
    const q = quest({ name: 'Clear loft', room: 'Hall', completedAt: daysAgo(3) });
    const { tends, errors } = parseTendsCsv(toTendsCsv([h, q], [{ id: 'm1', name: 'Alex', animal: '🦊' }]));
    expect(errors).toEqual([]);
    expect(tends[0]).toMatchObject({ kind: 'habit', name: 'Feed birds', room: 'Garden', group: 'Birds', tier: 'tortoise', energy: ['transition'], frequencyDays: 2, ownerName: 'Alex', status: 'active', description: 'Seed in the shed' });
    expect(tends[1]).toMatchObject({ kind: 'quest', name: 'Clear loft', completed: true });
  });
});

describe('mock history', () => {
  it('only dates active habits, never in the future, with wins for the last week', () => {
    let n = 0;
    const tends = [habit({ frequencyDays: 7 }), quest(), habit({ frequencyDays: 365 })];
    const members = [{ id: 'm', name: 'Alex', animal: '🦊' }];
    const out = mockHistory(tends, members, NOW, () => `w${++n}`, () => 0.2);
    expect(out.tends[1].lastDone).toBeUndefined();
    expect(out.tends.every((t) => t.lastDone == null || t.lastDone <= NOW)).toBe(true);
    expect(out.wins.map((w) => w.tendId)).toEqual([tends[0].id]);
  });
});
