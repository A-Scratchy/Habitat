import { daysBetween } from './dates';
import type { Tend } from './types';

export type Need = 'unknown' | 'resting' | 'soon' | 'thirsty' | 'wilting' | 'whenNeeded';

export const NEEDS: Record<Need, { emoji: string; label: string }> = {
  unknown: { emoji: '🥚', label: 'Not logged yet' },
  resting: { emoji: '🌳', label: 'Flourishing' },
  soon: { emoji: '🌿', label: 'Getting ready' },
  thirsty: { emoji: '💧', label: 'Thirsty' },
  wilting: { emoji: '🍂', label: 'Wilting' },
  whenNeeded: { emoji: '🌼', label: 'When needed' },
};

/**
 * Days since done ÷ frequency. 1 means due today; 2 means a whole extra cycle has passed.
 * Undefined when there is no schedule or the tend has never been logged.
 */
export function needRatio(tend: Tend, now: number): number | undefined {
  if (!tend.frequencyDays || tend.lastDone == null) return undefined;
  return daysBetween(tend.lastDone, now) / tend.frequencyDays;
}

/** Below this share of its schedule, a habit is resting (done recently). */
const RESTING_BELOW = 0.6;

export function needOf(tend: Tend, now: number): Need {
  if (tend.kind === 'habit' && tend.schedule === 'whenNeeded') return 'whenNeeded';
  const r = needRatio(tend, now);
  if (r === undefined) return 'unknown';
  if (r < RESTING_BELOW) return 'resting';
  if (r < 1) return 'soon';
  if (r < 2) return 'thirsty';
  return 'wilting';
}

/**
 * For "most needed first" lists: the need ratio, with never-logged habits placed just above
 * the resting ones. So something done a moment ago always drops below everything that might
 * still need doing, including habits nobody has logged yet.
 */
export function needRank(tend: Tend, now: number): number {
  if (tend.kind === 'habit' && tend.schedule === 'whenNeeded') {
    // No schedule, so never above anything that's due: the longer since it was done, the nearer the
    // never-logged ones; just done, down with the resting ones.
    if (tend.lastDone == null) return RESTING_BELOW;
    const days = daysBetween(tend.lastDone, now);
    return (RESTING_BELOW * days) / (days + 7);
  }
  return needRatio(tend, now) ?? RESTING_BELOW;
}
