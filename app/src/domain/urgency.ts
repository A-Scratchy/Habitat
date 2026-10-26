import { daysBetween } from './dates';
import type { Task } from './types';

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
 * Undefined when there is no schedule or the task has never been logged.
 */
export function needRatio(task: Task, now: number): number | undefined {
  if (!task.frequencyDays || task.lastDone == null) return undefined;
  return daysBetween(task.lastDone, now) / task.frequencyDays;
}

export function needOf(task: Task, now: number): Need {
  const r = needRatio(task, now);
  if (r === undefined) return 'unknown';
  if (r < 0.6) return 'resting';
  if (r < 1) return 'soon';
  if (r < 2) return 'thirsty';
  return 'wilting';
}
