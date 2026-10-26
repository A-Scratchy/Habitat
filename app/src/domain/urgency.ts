import { daysBetween } from './dates';
import type { Tend } from './types';

export type Need = 'unknown' | 'resting' | 'soon' | 'thirsty' | 'wilting';

export const NEEDS: Record<Need, { emoji: string; label: string }> = {
  unknown: { emoji: '🌰', label: 'Not yet known' },
  resting: { emoji: '🌳', label: 'Flourishing' },
  soon: { emoji: '🌿', label: 'Getting ready' },
  thirsty: { emoji: '💧', label: 'Thirsty' },
  wilting: { emoji: '🍂', label: 'Wilting' },
};

/**
 * Days since done ÷ frequency. 1 means due today; 2 means a whole extra cycle has passed.
 * Undefined when there is no schedule or the tend has never been logged.
 */
export function needRatio(tend: Tend, now: number): number | undefined {
  if (!tend.frequencyDays || tend.lastDone == null) return undefined;
  return daysBetween(tend.lastDone, now) / tend.frequencyDays;
}

export function needOf(tend: Tend, now: number): Need {
  const r = needRatio(tend, now);
  if (r === undefined) return 'unknown';
  if (r < 0.6) return 'resting';
  if (r < 1) return 'soon';
  if (r < 2) return 'thirsty';
  return 'wilting';
}
