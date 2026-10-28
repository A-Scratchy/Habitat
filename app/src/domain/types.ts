export type EffortTier = 'sloth' | 'tortoise' | 'bee' | 'elephant';

/** Habits keep coming back on a schedule; quests are one-offs that finish. Together they're "tending". */
export type TendKind = 'habit' | 'quest';

/** Availability only. Doing a tend is recorded as a Win plus `lastDone`, never as a status. */
export type TendStatus = 'active' | 'paused';

export type EnergyTag = 'micro' | 'brainless' | 'transition' | 'sensory';

/** How much leaving it undone hurts its room. Drives room health (weights 1 / 2 / 4). */
export type EcologicalImpact = 'small' | 'medium' | 'large';

/** A part of the home. Every habit and quest belongs to exactly one. */
export interface Room {
  id: string;
  name: string;
  /** An emoji, or missing for none (shown as a plain house). */
  icon?: string;
  /** Position in lists; lower comes first. */
  sortOrder: number;
}

/** "I'll do this today": valid only while `day` is today (local YYYY-MM-DD). */
export interface Claim {
  memberId: string;
  day: string;
}

/** Omit that keeps a union a union (plain Omit would merge Habit and Quest into one loose type). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What every tend has, habit or quest. */
interface TendBase {
  id: string;
  name: string;
  group?: string;
  /** Notes or step-by-step instructions; one step per line. */
  description?: string;
  tier: EffortTier;
  impact: EcologicalImpact;
  energy: EnergyTag[];
  status: TendStatus;
  /** Epoch ms. Missing means "not yet known", which is never treated as overdue. */
  lastDone?: number;
  claim?: Claim;
}

/** Comes back on a schedule. Always has one. */
export interface Habit extends TendBase {
  kind: 'habit';
  /** A habit always belongs to a room. */
  roomId: string;
  /** Permanent owner: "this is my zone". */
  ownerId?: string;
  /** Repeat interval in days. */
  frequencyDays: number;
  completedAt?: never;
}

/** A one-off. Never has a schedule; when done it moves to the Completed shelf. */
export interface Quest extends TendBase {
  kind: 'quest';
  /** Missing means it has no room: it's done out and about ("Go to tip"). */
  roomId?: string;
  /** Who can take it on: everyone, or particular members (at least one). It only shows on their Quests menu. */
  availableTo: 'everyone' | string[];
  ownerId?: never;
  frequencyDays?: never;
  /** When it was finished. Set means it's on the Completed shelf; restarting clears it. */
  completedAt?: number;
}

/** One thing that looks after the habitat. `kind` says which; it is always stated, never guessed. */
export type Tend = Habit | Quest;

/** What plays when someone finishes something. 'none' is a real choice: silence. */
export type CompletionSound = 'chime' | 'bell' | 'wood' | 'birdsong' | 'bubble' | 'harp' | 'none';

export const SOUND_ORDER: CompletionSound[] = ['chime', 'bell', 'wood', 'birdsong', 'bubble', 'harp', 'none'];

/** Everyone starts on the soft chime (the agreed default) until they choose. */
export const DEFAULT_SOUND: CompletionSound = 'chime';

export interface Member {
  id: string;
  name: string;
  animal: string;
  sound: CompletionSound;
}

export interface Win {
  id: string;
  tendId: string;
  tendName: string;
  /** Missing for a quest done out and about. */
  roomId?: string;
  /** The room's name when it was done, so the feed still reads right after a rename. */
  room?: string;
  memberId: string;
  /** Others tagged as having helped. */
  helperIds?: string[];
  at: number;
  /** The tend's lastDone before this win, so undo can restore it. */
  prevLastDone?: number;
  /** True when this win finished a quest, so undo can put it back on the open list. */
  completedQuest?: boolean;
}

export const DESCRIPTION_MAX = 1000;

export const isQuest = (t: Tend): t is Quest => t.kind === 'quest';
export const isHabit = (t: Tend): t is Habit => t.kind === 'habit';
export const isCompleted = (t: Tend): t is Quest => t.kind === 'quest' && t.completedAt != null;

export const KINDS: Record<TendKind, { emoji: string; label: string; plural: string; hint: string }> = {
  habit: { emoji: '🔁', label: 'Habit', plural: 'Habits', hint: 'Comes back on a schedule' },
  quest: { emoji: '🗺️', label: 'Quest', plural: 'Quests', hint: 'A one-off; it goes to Completed when done' },
};

export const IMPACT_ORDER: EcologicalImpact[] = ['small', 'medium', 'large'];

export const IMPACTS: Record<EcologicalImpact, { emoji: string; label: string; weight: number; hint: string }> = {
  small: { emoji: '🌱', label: 'Small', weight: 1, hint: 'The room barely notices if it waits' },
  medium: { emoji: '🌿', label: 'Medium', weight: 2, hint: 'Leaving it starts to show' },
  large: { emoji: '🌳', label: 'Large', weight: 4, hint: 'The room really suffers without it' },
};

export const roomIcon = (r: Room | undefined) => r?.icon || '🏠';

/** How a quest with no room is shown. */
export const OUT_AND_ABOUT = { icon: '🚶', name: 'Out and about' };

export const byRoomOrder = (a: Room, b: Room) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

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

export const STATUSES: Record<TendStatus, string> = {
  active: 'Active',
  paused: 'Paused',
};

export const ANIMALS = ['🦊', '🦉', '🐻', '🐰', '🦔', '🐸', '🦋', '🐿️', '🦡', '🐧', '🐨', '🐼', '🦒', '🐳', '🐞', '🦌'];
