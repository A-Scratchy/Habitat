import Papa from 'papaparse';
import { dayKey, parseDay } from './dates';
import { ENERGY_ORDER, type EffortTier, type EnergyTag, type Member, type Task, type TaskStatus } from './types';

export type ParsedTask = Omit<Task, 'id' | 'ownerId' | 'claim'> & { ownerName?: string };

export interface ParseResult {
  tasks: ParsedTask[];
  warnings: string[];
}

type Field = 'name' | 'room' | 'group' | 'tier' | 'energy' | 'frequency' | 'lastDone' | 'owner' | 'status';

const HEADER_ALIASES: Record<string, Field> = {
  chorename: 'name',
  name: 'name',
  task: 'name',
  room: 'room',
  roomarea: 'room',
  area: 'room',
  choregroup: 'group',
  group: 'group',
  efforttier: 'tier',
  effortlevel: 'tier',
  effort: 'tier',
  energytype: 'energy',
  energy: 'energy',
  frequencydays: 'frequency',
  frequency: 'frequency',
  lastdonedate: 'lastDone',
  lastdone: 'lastDone',
  permanentowner: 'owner',
  owner: 'owner',
  taskstatus: 'status',
  status: 'status',
};

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

/** Trim, collapse spaces, and tighten slashes: "Sweep / Hoover" → "Sweep/Hoover". */
export function tidyText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/ ?\/ ?/g, '/');
}

/** Returns a function that maps each spelling to the first-seen casing of it. */
function canonicaliser() {
  const seen = new Map<string, string>();
  return (s: string) => {
    const k = s.toLowerCase();
    if (!seen.has(k)) seen.set(k, s);
    return seen.get(k)!;
  };
}

export function parseTier(s: string): EffortTier | undefined {
  const v = s.toLowerCase();
  if (v.includes('sloth')) return 'sloth';
  if (v.includes('tortoise')) return 'tortoise';
  if (v.includes('bee')) return 'bee';
  if (v.includes('elephant') || v.includes('silverback')) return 'elephant';
  return undefined;
}

export function parseEnergy(s: string): EnergyTag[] {
  const v = s.toLowerCase();
  return ENERGY_ORDER.filter((tag) => v.includes(tag));
}

/** Legacy "Done" rows become active if they repeat, otherwise on-demand. */
export function parseStatus(s: string, hasFrequency: boolean): TaskStatus {
  const v = s.toLowerCase();
  if (v.includes('pause')) return 'paused';
  if (v.includes('demand')) return 'onDemand';
  if (v.includes('done')) return hasFrequency ? 'active' : 'onDemand';
  return 'active';
}

export function parseChoresCsv(text: string): ParseResult {
  const warnings: string[] = [];
  const { data, errors } = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  for (const e of errors.slice(0, 5)) warnings.push(`Row ${e.row ?? '?'}: ${e.message}`);
  if (data.length === 0) return { tasks: [], warnings: ['The file is empty.'] };

  const [header, ...rows] = data;
  const columns = new Map<Field, number>();
  header.forEach((h, i) => {
    const f = HEADER_ALIASES[headerKey(h)];
    if (f && !columns.has(f)) columns.set(f, i);
  });
  if (!columns.has('name')) return { tasks: [], warnings: ['No "Chore Name" column found.'] };

  const room = canonicaliser();
  const group = canonicaliser();
  const name = canonicaliser();
  const seen = new Set<string>();
  const tasks: ParsedTask[] = [];

  rows.forEach((row, i) => {
    const cell = (f: Field) => tidyText(columns.has(f) ? (row[columns.get(f)!] ?? '') : '');
    const line = i + 2;
    const rawName = cell('name');
    if (!rawName) return;

    const task: ParsedTask = {
      name: name(rawName),
      room: room(cell('room') || 'General'),
      tier: parseTier(cell('tier')) ?? 'bee',
      energy: parseEnergy(cell('energy')),
      status: 'active',
    };
    if (!parseTier(cell('tier'))) warnings.push(`Line ${line}: "${rawName}" has no recognised effort tier, so it's set to Worker Bee.`);

    const g = cell('group');
    if (g) task.group = group(g);

    const freq = parseFloat(cell('frequency'));
    if (freq > 0) task.frequencyDays = Math.round(freq);
    task.status = parseStatus(cell('status'), !!task.frequencyDays);

    const last = cell('lastDone');
    if (last) {
      const t = parseDay(last);
      if (t === undefined) warnings.push(`Line ${line}: couldn't read last-done date "${last}".`);
      else task.lastDone = t;
    }

    const owner = cell('owner');
    if (owner) task.ownerName = owner;

    const key = `${task.room}|${task.name}`.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`Line ${line}: "${task.name}" appears twice in ${task.room}; kept the first.`);
      return;
    }
    seen.add(key);
    tasks.push(task);
  });

  return { tasks, warnings };
}

const TIER_EXPORT: Record<EffortTier, string> = {
  sloth: '🦥 Sloth Tier',
  tortoise: '🐢 Tortoise Tier',
  bee: '🐝 Worker Bee Tier',
  elephant: '🐘 Elephant Tier',
};

const STATUS_EXPORT: Record<TaskStatus, string> = { active: 'Active', paused: 'Paused', onDemand: 'On Demand' };

export function toChoresCsv(tasks: Task[], members: Member[]): string {
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  return Papa.unparse({
    fields: ['Chore Name', 'Room', 'Chore Group', 'Effort Tier', 'Energy Type', 'Frequency (Days)', 'Last Done Date', 'Permanent Owner', 'Task status'],
    data: tasks.map((t) => [
      t.name,
      t.room,
      t.group ?? '',
      TIER_EXPORT[t.tier],
      t.energy.join(', '),
      t.frequencyDays ?? '',
      t.lastDone != null ? dayKey(t.lastDone) : '',
      (t.ownerId && memberName.get(t.ownerId)) ?? '',
      STATUS_EXPORT[t.status],
    ]),
  });
}
