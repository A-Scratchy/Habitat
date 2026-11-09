import type { EarlierTotals } from '../data/remote';
import { TIER_ACORNS } from './report';
import { TIER_ORDER, type EffortTier, type Gift, type GiftKind, type Tend, type Win } from './types';

/*
 * Two just-for-fun currencies, both weighted by effort tier (🦥 1 · 🐢 2 · 🐝 3 · 🐘 5):
 *  🌰 Acorns are personal: a private purse, shown only to whoever is using the device. Everything
 *     you do earns its tier's acorns, plus any bounty on it; a job done together splits both.
 *  🫐 Berries are the pack's: one shared jar that everything anyone does fills. Nobody is named.
 */

/** A bounty is a multiple of what the job normally earns: double by default, so a Worker Bee job (3) offers 3, 6 or 9. */
export const BOUNTY_MULTIPLES = [1, 2, 3] as const;
export const DEFAULT_BOUNTY_MULTIPLE = 2;
/** The server's limit too: comfortably above an Elephant job tripled. */
export const BOUNTY_MAX = 50;

export const bountyPicks = (tier: EffortTier) => BOUNTY_MULTIPLES.map((m) => ({ multiple: m, acorns: TIER_ACORNS[tier] * m }));

/** Everyone tagged on a win, the person who did it first. */
const creditedTo = (w: Win) => [w.memberId, ...(w.helperIds ?? [])];

/** What a win earns each person on it. */
export const acornsEach = (w: Win) => (TIER_ACORNS[w.tier] + (w.bounty ?? 0)) / creditedTo(w).length;

/** What acorns can buy. All the same price for now: one Worker Bee job. */
export const GIFTS: Record<GiftKind, { emoji: string; label: string; arrives: string; acorns: number }> = {
  hug: { emoji: '🫂', label: 'Hug', arrives: 'sent you a hug', acorns: 3 },
  highFive: { emoji: '🙌', label: 'High-five', arrives: 'sent you a high-five', acorns: 3 },
  thankYou: { emoji: '💐', label: 'Thank you', arrives: 'says thank you', acorns: 3 },
};

/**
 * One person's acorns: their part of every win on this device, plus older ones the first download
 * only sent totals for, less what they've spent on gifts.
 */
export function purse(wins: Win[], gifts: Gift[], memberId: string, earlier: EarlierTotals | undefined): number {
  let total = 0;
  for (const g of gifts) if (g.fromId === memberId) total -= g.acorns;
  for (const w of wins) if (creditedTo(w).includes(memberId)) total += acornsEach(w);
  for (const s of earlier?.shares ?? []) if (s.memberId === memberId) total += s.share * TIER_ACORNS[s.tier];
  for (const b of earlier?.bounties ?? []) if (b.memberId === memberId) total += b.acorns;
  return Math.round(total);
}

/** The pack's berries: every win's effort, whoever did it. */
export function berries(wins: Win[], earlier: EarlierTotals | undefined): number {
  let total = 0;
  for (const w of wins) total += TIER_ACORNS[w.tier];
  for (const t of earlier?.tiers ?? []) total += t.count * TIER_ACORNS[t.tier];
  return total;
}

/** The bounty a win done at `at` would pay: only one posted by then. */
export const bountyFor = (t: Tend, at: number) => (t.bounty && at >= t.bounty.postedAt ? t.bounty.acorns : 0);

/** What's on the bounty board, longest-waiting first. */
export const onBoard = (tends: Tend[]) => tends.filter((t) => t.bounty).sort((a, b) => a.bounty!.postedAt - b.bounty!.postedAt);

/** Totals for older wins from the first download; none for the demo or a local-only habitat. */
export function readEarlier(value: string | undefined): EarlierTotals | undefined {
  if (value === undefined) return undefined;
  const e = JSON.parse(value) as EarlierTotals;
  for (const t of [...e.tiers, ...e.shares]) if (!TIER_ORDER.includes(t.tier)) throw new Error(`Saved totals have an effort tier this app doesn't know: “${t.tier}”.`);
  return e;
}
