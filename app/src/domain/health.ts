import { dayKey, DAY, startOfWeek } from './dates';
import { IMPACTS, type Room, type Tend, type Win } from './types';
import { needOf } from './urgency';

export type HealthLevel = 'flourishing' | 'healthy' | 'thirsty' | 'wilting' | 'unknown' | 'resting';

export const HEALTH: Record<HealthLevel, { emoji: string; label: string }> = {
  flourishing: { emoji: '🌳', label: 'Flourishing' },
  healthy: { emoji: '🌿', label: 'Healthy' },
  thirsty: { emoji: '💧', label: 'Thirsty' },
  wilting: { emoji: '🍂', label: 'Wilting' },
  unknown: { emoji: '🌰', label: 'Not yet known' },
  resting: { emoji: '🌱', label: 'Nothing scheduled' },
};

export interface Health {
  level: HealthLevel;
  /** 1 = flourishing, 0 = everything wilting. Undefined when there's nothing to judge yet. */
  score?: number;
  thirsty: number;
  wilting: number;
}

/** Penalty points: thirsty counts once, wilting twice, each times its ecological impact weight. */
interface Tally {
  penalty: number;
  max: number;
  habits: number;
  known: number;
  thirsty: number;
  wilting: number;
}

/** Only active habits count: quests have no schedule, so they can never make a room look worse. */
function tally(tends: Tend[], now: number): Tally {
  const t: Tally = { penalty: 0, max: 0, habits: 0, known: 0, thirsty: 0, wilting: 0 };
  for (const tend of tends) {
    if (tend.kind !== 'habit' || tend.status !== 'active') continue;
    t.habits++;
    const need = needOf(tend, now);
    if (need === 'unknown') continue;
    const weight = IMPACTS[tend.impact].weight;
    t.known++;
    t.max += 2 * weight;
    if (need === 'thirsty') {
      t.penalty += weight;
      t.thirsty++;
    } else if (need === 'wilting') {
      t.penalty += 2 * weight;
      t.wilting++;
    }
  }
  return t;
}

function toHealth(t: Tally): Health {
  const base = { thirsty: t.thirsty, wilting: t.wilting };
  if (t.habits === 0) return { ...base, level: 'resting' };
  if (t.known === 0) return { ...base, level: 'unknown' };
  const score = 1 - t.penalty / t.max;
  const level = score >= 0.85 ? 'flourishing' : score >= 0.65 ? 'healthy' : score >= 0.4 ? 'thirsty' : 'wilting';
  return { ...base, level, score };
}

/** How one room is doing: its overdue habits, weighted by how much each matters to it. */
export function roomHealth(room: Room, tends: Tend[], now: number): Health {
  return toHealth(tally(tends.filter((t) => t.roomId === room.id), now));
}

/** The whole home, weighted the same way, so a big neglected kitchen counts for more than a cupboard. */
export function habitatHealth(tends: Tend[], now: number): Health {
  return toHealth(tally(tends, now));
}

export interface PackTotals {
  today: number;
  yesterday: number;
  week: number;
}

/** What the pack did together. Team totals only: nobody is counted or ranked on their own. */
export function packTotals(wins: Win[], now: number): PackTotals {
  const today = dayKey(now);
  const yesterday = dayKey(now - DAY);
  const weekStart = startOfWeek(now);
  return {
    today: wins.filter((w) => dayKey(w.at) === today).length,
    yesterday: wins.filter((w) => dayKey(w.at) === yesterday).length,
    week: wins.filter((w) => w.at >= weekStart).length,
  };
}
