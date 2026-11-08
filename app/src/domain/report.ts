import { startOfDay, startOfWeek } from './dates';
import { OUT_AND_ABOUT, TIER_ORDER, byRoomOrder, roomIcon, type EffortTier, type Member, type Room, type Tend, type Win } from './types';

/** How far back a report looks at once. */
export type Period = 'day' | 'week' | 'month';

export const PERIODS: Record<Period, { label: string; this: string; last: string; bars: number }> = {
  day: { label: 'Day', this: 'today', last: 'yesterday', bars: 7 },
  week: { label: 'Week', this: 'this week', last: 'last week', bars: 6 },
  month: { label: 'Month', this: 'this month', last: 'last month', bars: 6 },
};

/** Acorns: effort, weighted by tier, so one big job counts for more than one tiny one. */
export const TIER_ACORNS: Record<EffortTier, number> = { sloth: 1, tortoise: 2, bee: 3, elephant: 5 };

/** Start of the day, week (Monday) or calendar month containing t, local time. */
export function periodStart(period: Period, t: number): number {
  if (period === 'day') return startOfDay(t);
  if (period === 'week') return startOfWeek(t);
  const d = new Date(startOfDay(t));
  d.setDate(1);
  return d.getTime();
}

/** The start of the period n periods after the one starting at `start` (negative: earlier). Calendar-aware, so DST and month lengths are right. */
export function shiftPeriod(period: Period, start: number, n: number): number {
  const d = new Date(start);
  if (period === 'day') d.setDate(d.getDate() + n);
  else if (period === 'week') d.setDate(d.getDate() + 7 * n);
  else d.setMonth(d.getMonth() + n);
  return d.getTime();
}

/** A short name for a bar: "Mon", "27 Oct", "Nov". */
export function barLabel(period: Period, start: number): string {
  const d = new Date(start);
  if (period === 'day') return d.toLocaleDateString('en-GB', { weekday: 'short' });
  if (period === 'week') return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-GB', { month: 'short' });
}

/** Everyone tagged on a win, the person who did it first. */
const creditedTo = (w: Win) => [w.memberId, ...(w.helperIds ?? [])];

const acornsOf = (wins: Win[]) => wins.reduce((n, w) => n + TIER_ACORNS[w.tier], 0);

const within = (wins: Win[], from: number, to: number) => wins.filter((w) => w.at >= from && w.at < to);

export interface Bar {
  start: number;
  label: string;
  acorns: number;
  done: number;
  current: boolean;
}

export interface RoomShare {
  key: string;
  name: string;
  icon: string;
  acorns: number;
  done: number;
}

export interface PackReport {
  period: Period;
  start: number;
  acorns: number;
  done: number;
  /** The same stretch of the previous period (e.g. last week up to this time on the same weekday), so a half-done week isn't compared with a whole one. */
  before: { acorns: number; done: number };
  /** Oldest first; the last is the current period. */
  bars: Bar[];
  /** Most effort first; only rooms that had some. */
  rooms: RoomShare[];
  tiers: { tier: EffortTier; acorns: number; done: number }[];
  /** Done this period that are habits with no schedule: the behind-the-scenes care. */
  whenNeeded: number;
  /** Rooms with something active to look after that had nothing done this period, in room order. */
  quiet: Room[];
}

/** The whole pack's effort over a period. Nobody is named: it's what the pack did together. */
export function packReport(wins: Win[], tends: Tend[], rooms: Room[], period: Period, now: number): PackReport {
  const start = periodStart(period, now);
  const end = now + 1;
  const current = within(wins, start, end);
  const prevStart = shiftPeriod(period, start, -1);
  const before = within(wins, prevStart, Math.min(prevStart + (end - start), start));

  const bars: Bar[] = [];
  for (let i = PERIODS[period].bars - 1; i >= 0; i--) {
    const s = shiftPeriod(period, start, -i);
    const inBar = within(wins, s, i === 0 ? end : shiftPeriod(period, s, 1));
    bars.push({ start: s, label: barLabel(period, s), acorns: acornsOf(inBar), done: inBar.length, current: i === 0 });
  }

  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const byRoom = new Map<string, RoomShare>();
  for (const w of current) {
    const key = w.roomId ?? '';
    const room = w.roomId ? roomById.get(w.roomId) : undefined;
    const share = byRoom.get(key) ?? {
      key,
      name: w.roomId ? (room?.name ?? w.room ?? 'A removed room') : OUT_AND_ABOUT.name,
      icon: w.roomId ? roomIcon(room) : OUT_AND_ABOUT.icon,
      acorns: 0,
      done: 0,
    };
    share.acorns += TIER_ACORNS[w.tier];
    share.done++;
    byRoom.set(key, share);
  }

  const tendById = new Map(tends.map((t) => [t.id, t]));
  const cared = new Set(current.map((w) => w.roomId));
  const looked = new Set(tends.filter((t) => t.status === 'active' && t.roomId && !(t.kind === 'quest' && t.completedAt != null)).map((t) => t.roomId));

  return {
    period,
    start,
    acorns: acornsOf(current),
    done: current.length,
    before: { acorns: acornsOf(before), done: before.length },
    bars,
    rooms: [...byRoom.values()].sort((a, b) => b.acorns - a.acorns || a.name.localeCompare(b.name)),
    tiers: TIER_ORDER.map((tier) => {
      const of = current.filter((w) => w.tier === tier);
      return { tier, acorns: acornsOf(of), done: of.length };
    }),
    whenNeeded: current.filter((w) => {
      const t = tendById.get(w.tendId);
      return t?.kind === 'habit' && t.schedule === 'whenNeeded';
    }).length,
    quiet: [...rooms].sort(byRoomOrder).filter((r) => looked.has(r.id) && !cared.has(r.id)),
  };
}

/** A gentle comparison with the same point last period. Never a score: less is fine too. */
export function comparison(r: PackReport): string {
  const { last } = PERIODS[r.period];
  const now = r.acorns;
  const then = r.before.acorns;
  if (now === 0 && then === 0) return `A quiet spell, ${last} too. Rest counts.`;
  if (then === 0) return `More than by this point ${last} 🌱`;
  const ratio = now / then;
  if (ratio >= 1.15) return `More than by this point ${last} 🌱`;
  if (ratio > 0.85) return `About the same as by this point ${last}.`;
  return `Quieter than by this point ${last}. That’s fine: rest counts too 🌙`;
}

export interface MemberShare {
  member: Member;
  /** A shared job's acorns are split between everyone tagged. */
  acorns: number;
  /** Things they did or helped with. */
  done: number;
}

export interface ShareReport {
  start: number;
  total: number;
  /** Everyone in the pack, in name order (never ranked). */
  members: MemberShare[];
  /** One person's share of the acorns in each recent period, oldest first: 0–1, or undefined when nothing was done. */
  trend: { start: number; label: string; share?: number; current: boolean }[];
}

function sharesIn(wins: Win[]): Map<string, { acorns: number; done: number }> {
  const out = new Map<string, { acorns: number; done: number }>();
  for (const w of wins) {
    const who = creditedTo(w);
    for (const id of who) {
      const s = out.get(id) ?? { acorns: 0, done: 0 };
      s.acorns += TIER_ACORNS[w.tier] / who.length;
      s.done++;
      out.set(id, s);
    }
  }
  return out;
}

/** Who carried how much of the load. Only for the habitat's owner, to check their own share. */
export function shareReport(wins: Win[], members: Member[], focusId: string, period: Period, now: number): ShareReport {
  const start = periodStart(period, now);
  const end = now + 1;
  const current = within(wins, start, end);
  const shares = sharesIn(current);
  const trend = [];
  for (let i = PERIODS[period].bars - 1; i >= 0; i--) {
    const s = shiftPeriod(period, start, -i);
    const inBar = within(wins, s, i === 0 ? end : shiftPeriod(period, s, 1));
    const total = acornsOf(inBar);
    trend.push({ start: s, label: barLabel(period, s), share: total ? (sharesIn(inBar).get(focusId)?.acorns ?? 0) / total : undefined, current: i === 0 });
  }
  return {
    start,
    total: acornsOf(current),
    members: [...members]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((member) => ({ member, acorns: shares.get(member.id)?.acorns ?? 0, done: shares.get(member.id)?.done ?? 0 })),
    trend,
  };
}

/** The oldest win any report looks at: the first bar of the longest view. */
export const reportSince = (now: number) => shiftPeriod('month', periodStart('month', now), -(PERIODS.month.bars - 1));

export const roundAcorns = (n: number) => Math.round(n * 10) / 10;
