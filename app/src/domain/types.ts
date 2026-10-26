export type EffortTier = 'sloth' | 'tortoise' | 'bee' | 'elephant';

/** Availability only. Completion is recorded as a Win plus `lastDone`, never as a status. */
export type TaskStatus = 'active' | 'paused' | 'onDemand';

export type EnergyTag = 'micro' | 'brainless' | 'transition' | 'sensory';

/** "I'll do this today" — valid only while `day` is today (local YYYY-MM-DD). */
export interface Claim {
  memberId: string;
  day: string;
}

export interface Task {
  id: string;
  name: string;
  room: string;
  group?: string;
  tier: EffortTier;
  energy: EnergyTag[];
  /** Repeat interval in days. Missing means no schedule (on-demand or one-off). */
  frequencyDays?: number;
  status: TaskStatus;
  /** Epoch ms. Missing means "not yet known", which is never treated as overdue. */
  lastDone?: number;
  /** Permanent owner: "this is my zone". */
  ownerId?: string;
  claim?: Claim;
}

export interface Member {
  id: string;
  name: string;
  animal: string;
}

export interface Win {
  id: string;
  taskId: string;
  taskName: string;
  room: string;
  memberId: string;
  /** Others tagged as having helped. */
  helperIds?: string[];
  at: number;
  /** Task's lastDone before this win, so undo can restore it. */
  prevLastDone?: number;
}

export const TIER_ORDER: EffortTier[] = ['sloth', 'tortoise', 'bee', 'elephant'];

export const TIERS: Record<EffortTier, { emoji: string; label: string; hint: string }> = {
  sloth: { emoji: '🦥', label: 'Sloth', hint: 'Stationary, almost effortless' },
  tortoise: { emoji: '🐢', label: 'Tortoise', hint: 'Moving about, low exertion' },
  bee: { emoji: '🐝', label: 'Worker Bee', hint: 'Active, 5–15 minutes' },
  elephant: { emoji: '🐘', label: 'Elephant', hint: 'Heavy, long or big' },
};

export const ENERGY_ORDER: EnergyTag[] = ['micro', 'brainless', 'transition', 'sensory'];

export const ENERGY: Record<EnergyTag, { emoji: string; label: string; hint: string }> = {
  micro: { emoji: '⏱️', label: 'Micro-step', hint: 'Under a minute' },
  brainless: { emoji: '☁️', label: 'Brainless', hint: 'No decisions needed' },
  transition: { emoji: '🚶', label: 'Transition', hint: 'Do it while passing by' },
  sensory: { emoji: '🫧', label: 'Sensory friendly', hint: 'Quiet, dry, no gross textures' },
};

export const STATUSES: Record<TaskStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  onDemand: 'On demand',
};

export const ANIMALS = ['🦊', '🦉', '🐻', '🐰', '🦔', '🐸', '🦋', '🐿️', '🦡', '🐧', '🐨', '🐼', '🦒', '🐳', '🐞', '🦌'];
