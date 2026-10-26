import { dayKey, daysBetween, HOUR, startOfWeek } from './dates';
import { isCompleted, isHabit, TIER_ORDER, type EffortTier, type EnergyTag, type Tend, type TendKind, type Win } from './types';
import { needOf, needRatio } from './urgency';

export interface ViewContext {
  now: number;
  memberId?: string;
}

export const doneToday = (t: Tend, now: number) => t.lastDone != null && dayKey(t.lastDone) === dayKey(now);

export const claimedToday = (t: Tend, now: number) => !!t.claim && t.claim.day === dayKey(now);

export const isClaimedByOther = (t: Tend, ctx: ViewContext) =>
  claimedToday(t, ctx.now) && t.claim!.memberId !== ctx.memberId;

export const isOwnedByOther = (t: Tend, ctx: ViewContext) => !!t.ownerId && t.ownerId !== ctx.memberId;

/** Someone else's zone or someone else's job today: hide the Done button and keep it out of suggestions. */
export const isHandsOff = (t: Tend, ctx: ViewContext) => isOwnedByOther(t, ctx) || isClaimedByOther(t, ctx);

/** "today", "yesterday", "5 days ago", or undefined if never logged. */
export function lastDoneLabel(t: Tend, now: number): string | undefined {
  if (t.lastDone == null) return undefined;
  const d = daysBetween(t.lastDone, now);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

/** Not paused, and (for quests) not finished: something that can be done now. */
export const isOpen = (t: Tend) => t.status === 'active' && !isCompleted(t);

/** Active habits that haven't been done yet today: the pool the daily screens choose from. */
export function dailyPool(tends: Tend[], ctx: ViewContext): Tend[] {
  return tends.filter((t) => isHabit(t) && isOpen(t) && !doneToday(t, ctx.now));
}

export function myClaims(tends: Tend[], ctx: ViewContext): Tend[] {
  return tends.filter(
    (t) => isOpen(t) && !doneToday(t, ctx.now) && claimedToday(t, ctx.now) && t.claim!.memberId === ctx.memberId,
  );
}

/**
 * One tend per effort tier, each the most-needed of its tier by schedule.
 * `round` steps each tier to its next candidate, wrapping, for "show me a different set".
 */
export function quickSet(tends: Tend[], ctx: ViewContext, round = 0): Tend[] {
  const pool = dailyPool(tends, ctx)
    .filter((t) => !isHandsOff(t, ctx) && needOf(t, ctx.now) !== 'resting' && needOf(t, ctx.now) !== 'unknown')
    .sort((a, b) => needRatio(b, ctx.now)! - needRatio(a, ctx.now)! || a.name.localeCompare(b.name));
  return TIER_ORDER.flatMap((tier) => {
    const ofTier = pool.filter((t) => t.tier === tier);
    return ofTier.length ? [ofTier[round % ofTier.length]] : [];
  });
}

/** Low-effort candidates for Sloth & Tortoise mode. */
export function quickWinsPool(tends: Tend[], ctx: ViewContext): Tend[] {
  return dailyPool(tends, ctx).filter(
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

export interface BrowseFilter {
  roomId?: string;
  query?: string;
  tiers?: EffortTier[];
  energy?: EnergyTag[];
}

/** Searches the name, group, description and (if given) the room's name. */
export function matchesQuery(t: Tend, query: string, roomName = ''): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [t.name, roomName, t.group ?? '', t.description ?? ''].some((s) => s.toLowerCase().includes(q));
}

/**
 * Open habits (Forage) or open quests (Quests), most urgent first. Nothing is hidden for being
 * recently done, since some habits need doing again sooner than their schedule says. Paused tends
 * and finished quests never show here (they live in the Tending tab and the Completed shelf).
 */
export function browse(tends: Tend[], ctx: ViewContext, kind: TendKind, f: BrowseFilter, roomName: (id: string) => string = () => ''): Tend[] {
  const rank = (t: Tend) => needRatio(t, ctx.now) ?? -1;
  const inScope = (t: Tend) => isOpen(t) && t.kind === kind && (!f.roomId || t.roomId === f.roomId);
  return tends
    .filter(
      (t) =>
        inScope(t) &&
        matchesQuery(t, f.query ?? '', roomName(t.roomId)) &&
        (!f.tiers?.length || f.tiers.includes(t.tier)) &&
        (!f.energy?.length || f.energy.every((e) => t.energy.includes(e))),
    )
    .sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
}

/** Other tends that can be ticked off with "do all" alongside this one. */
export function groupMates(tends: Tend[], tend: Tend, ctx: ViewContext): Tend[] {
  if (!tend.group) return [];
  const g = tend.group.toLowerCase();
  return tends.filter(
    (t) =>
      t.id !== tend.id &&
      t.group?.toLowerCase() === g &&
      isHabit(t) &&
      isOpen(t) &&
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

/** The Completed shelf: finished quests, most recent first. */
export function completedQuests(tends: Tend[]): Tend[] {
  return tends.filter(isCompleted).sort((a, b) => b.completedAt! - a.completedAt!);
}
