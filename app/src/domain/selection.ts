import { dayKey, daysBetween, HOUR, startOfWeek } from './dates';
import { TIER_ORDER, type EffortTier, type EnergyTag, type Task, type Win } from './types';
import { needOf, needRatio } from './urgency';

export interface ViewContext {
  now: number;
  memberId?: string;
}

export const doneToday = (t: Task, now: number) => t.lastDone != null && dayKey(t.lastDone) === dayKey(now);

export const claimedToday = (t: Task, now: number) => !!t.claim && t.claim.day === dayKey(now);

export const isClaimedByOther = (t: Task, ctx: ViewContext) =>
  claimedToday(t, ctx.now) && t.claim!.memberId !== ctx.memberId;

export const isOwnedByOther = (t: Task, ctx: ViewContext) => !!t.ownerId && t.ownerId !== ctx.memberId;

/** Someone else's zone or someone else's job today: hide the Done button and keep it out of suggestions. */
export const isHandsOff = (t: Task, ctx: ViewContext) => isOwnedByOther(t, ctx) || isClaimedByOther(t, ctx);

/** "today", "yesterday", "5 days ago", or undefined if never logged. */
export function lastDoneLabel(t: Task, now: number): string | undefined {
  if (t.lastDone == null) return undefined;
  const d = daysBetween(t.lastDone, now);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

/** Active routine tasks that haven't been done yet today. */
export function dailyPool(tasks: Task[], ctx: ViewContext): Task[] {
  return tasks.filter((t) => t.status === 'active' && !doneToday(t, ctx.now));
}

export function myClaims(tasks: Task[], ctx: ViewContext): Task[] {
  return tasks.filter(
    (t) => t.status !== 'paused' && !doneToday(t, ctx.now) && claimedToday(t, ctx.now) && t.claim!.memberId === ctx.memberId,
  );
}

/**
 * One task per effort tier, each the most-needed of its tier by schedule.
 * `round` steps each tier to its next candidate, wrapping, for "show me a different set".
 */
export function quickSet(tasks: Task[], ctx: ViewContext, round = 0): Task[] {
  const pool = dailyPool(tasks, ctx)
    .filter((t) => !isHandsOff(t, ctx) && needOf(t, ctx.now) !== 'resting' && needOf(t, ctx.now) !== 'unknown')
    .sort((a, b) => needRatio(b, ctx.now)! - needRatio(a, ctx.now)! || a.name.localeCompare(b.name));
  return TIER_ORDER.flatMap((tier) => {
    const ofTier = pool.filter((t) => t.tier === tier);
    return ofTier.length ? [ofTier[round % ofTier.length]] : [];
  });
}

/** Low-effort candidates for Sloth & Tortoise mode. */
export function quickWinsPool(tasks: Task[], ctx: ViewContext): Task[] {
  return dailyPool(tasks, ctx).filter(
    (t) =>
      !isHandsOff(t, ctx) &&
      needOf(t, ctx.now) !== 'resting' &&
      (t.tier === 'sloth' || t.tier === 'tortoise' || t.energy.includes('micro') || t.energy.includes('brainless')),
  );
}

export function pickRandom<T extends { id: string }>(pool: T[], excludeId?: string, rnd = Math.random): T | undefined {
  const options = pool.length > 1 ? pool.filter((x) => x.id !== excludeId) : pool;
  return options[Math.floor(rnd() * options.length)];
}

/** Pseudo-room that lists every on-demand task, whatever room it belongs to. */
export const ON_DEMAND = '__on-demand';

export interface BrowseFilter {
  room?: string;
  query?: string;
  tiers?: EffortTier[];
  energy?: EnergyTag[];
}

export function matchesQuery(t: Task, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [t.name, t.room, t.group ?? ''].some((s) => s.toLowerCase().includes(q));
}

/**
 * The master list, most urgent first. Nothing is hidden for being recently done, since some
 * jobs need doing again sooner than their schedule says. A room shows its active tasks; the
 * on-demand pseudo-room shows on-demand ones; a search with no room covers both.
 */
export function browse(tasks: Task[], ctx: ViewContext, f: BrowseFilter): Task[] {
  const rank = (t: Task) => needRatio(t, ctx.now) ?? -1;
  const inScope = (t: Task) =>
    f.room === ON_DEMAND ? t.status === 'onDemand' : f.room ? t.status === 'active' && t.room === f.room : t.status !== 'paused';
  return tasks
    .filter(
      (t) =>
        inScope(t) &&
        matchesQuery(t, f.query ?? '') &&
        (!f.tiers?.length || f.tiers.includes(t.tier)) &&
        (!f.energy?.length || f.energy.every((e) => t.energy.includes(e))),
    )
    .sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
}

/** Other tasks that can be ticked off with "do all" alongside this one. */
export function groupMates(tasks: Task[], task: Task, ctx: ViewContext): Task[] {
  if (!task.group) return [];
  const g = task.group.toLowerCase();
  return tasks.filter(
    (t) =>
      t.id !== task.id &&
      t.group?.toLowerCase() === g &&
      t.status === 'active' &&
      !doneToday(t, ctx.now) &&
      !isHandsOff(t, ctx),
  );
}

export const winMembers = (w: Win) => [w.memberId, ...(w.helperIds ?? [])];

export const winsSince = (wins: Win[], since: number) => wins.filter((w) => w.at >= since);

export const momentum = (wins: Win[], now: number) => winsSince(wins, now - 2 * HOUR).length;

export interface WeekSummary {
  total: number;
  helpers: number;
  rooms: [string, number][];
}

/** Team totals only: no per-person counts, so nobody is ranked. */
export function weekSummary(wins: Win[], now: number): WeekSummary {
  const week = winsSince(wins, startOfWeek(now));
  const rooms = new Map<string, number>();
  for (const w of week) rooms.set(w.room, (rooms.get(w.room) ?? 0) + 1);
  return {
    total: week.length,
    helpers: new Set(week.flatMap(winMembers)).size,
    rooms: [...rooms].sort((a, b) => b[1] - a[1]),
  };
}
