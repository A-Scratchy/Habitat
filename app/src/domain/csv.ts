import Papa from 'papaparse';
import { dayKey, parseDay } from './dates';
import { DESCRIPTION_MAX, ENERGY_ORDER, type DistributiveOmit, type EffortTier, type EnergyTag, type Member, type Tend, type TendKind, type TendStatus } from './types';

/** A row ready to import. `completed`: a quest the file marks Done (it goes straight to the Completed shelf). */
export type ParsedTend = DistributiveOmit<Tend, 'id' | 'ownerId' | 'claim' | 'completedAt'> & { ownerName?: string; completed?: boolean };

/** Any error stops the import: `tends` is then empty and nothing is saved. */
export interface ParseResult {
  tends: ParsedTend[];
  errors: string[];
}

type Field = 'name' | 'room' | 'group' | 'description' | 'kind' | 'tier' | 'energy' | 'frequency' | 'lastDone' | 'owner' | 'status';

const HEADER_ALIASES: Record<string, Field> = {
  chorename: 'name',
  tendname: 'name',
  name: 'name',
  tend: 'name',
  kind: 'kind',
  description: 'description',
  instructions: 'description',
  notes: 'description',
  type: 'kind',
  room: 'room',
  roomarea: 'room',
  area: 'room',
  choregroup: 'group',
  tendgroup: 'group',
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
  tendstatus: 'status',
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

export function parseKind(s: string): TendKind | undefined {
  const v = s.trim().toLowerCase();
  return v === 'habit' ? 'habit' : v === 'quest' ? 'quest' : undefined;
}

/** Blank means Active. "Done" is only for quests. Anything else is an error. */
export function parseStatus(s: string): { status: TendStatus; done: boolean } | undefined {
  const v = s.trim().toLowerCase();
  if (v === '' || v === 'active') return { status: 'active', done: false };
  if (v === 'paused') return { status: 'paused', done: false };
  if (v === 'done') return { status: 'active', done: true };
  return undefined;
}

/**
 * Reads a tends CSV strictly: every row must say whether it's a Habit or a Quest, habits need a
 * frequency and quests must not have one. Any problem is an error with its line number, and then
 * nothing is imported, so the master list never ends up half right.
 */
export function parseTendsCsv(text: string): ParseResult {
  const errors: string[] = [];
  const { data, errors: csvErrors } = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  for (const e of csvErrors.slice(0, 5)) errors.push(`Row ${e.row ?? '?'}: ${e.message}`);
  if (data.length === 0) return { tends: [], errors: ['The file is empty.'] };

  const [header, ...rows] = data;
  const columns = new Map<Field, number>();
  header.forEach((h, i) => {
    const f = HEADER_ALIASES[headerKey(h)];
    if (f && !columns.has(f)) columns.set(f, i);
  });
  if (!columns.has('name')) return { tends: [], errors: ['No "Name" column found.'] };
  if (!columns.has('kind')) return { tends: [], errors: ['No "Kind" column found. Add one saying Habit or Quest for every row.'] };

  const room = canonicaliser();
  const group = canonicaliser();
  const name = canonicaliser();
  const seen = new Set<string>();
  const tends: ParsedTend[] = [];

  rows.forEach((row, i) => {
    const cell = (f: Field) => tidyText(columns.has(f) ? (row[columns.get(f)!] ?? '') : '');
    const line = i + 2;
    const rawName = cell('name');
    if (!rawName) return;
    const problem = (msg: string) => errors.push(`Line ${line} (“${rawName}”): ${msg}`);
    const before = errors.length;

    const kind = parseKind(cell('kind'));
    if (!kind) problem(`Kind must be Habit or Quest, not “${cell('kind')}”.`);

    const tier = parseTier(cell('tier'));
    if (!tier) problem(`Effort Tier must be Sloth, Tortoise, Worker Bee or Elephant, not “${cell('tier')}”.`);

    const freqText = cell('frequency');
    const freq = Number(freqText);
    if (kind === 'habit' && !(Number.isInteger(freq) && freq >= 1 && freq <= 3650))
      problem(`a Habit needs a Frequency (Days) between 1 and 3650, not “${freqText}”.`);
    if (kind === 'quest' && freqText !== '') problem('a Quest has no Frequency (Days); leave it blank.');

    const status = parseStatus(cell('status'));
    if (!status) problem(`Status must be Active, Paused or Done, not “${cell('status')}”.`);
    if (kind === 'habit' && status?.done) problem('only Quests can be Done.');

    let lastDone: number | undefined;
    const last = cell('lastDone');
    if (last) {
      lastDone = parseDay(last);
      if (lastDone === undefined) problem(`Last Done Date “${last}” isn't a date (use YYYY-MM-DD or DD/MM/YYYY).`);
    }

    // Descriptions keep their line breaks (one step per line), so read them untidied.
    const description = (columns.has('description') ? (row[columns.get('description')!] ?? '') : '').trim();
    if (description.length > DESCRIPTION_MAX) problem(`the description is longer than ${DESCRIPTION_MAX} characters.`);

    const key = `${cell('room') || 'General'}|${rawName}`.toLowerCase();
    if (seen.has(key)) problem(`it's listed twice in ${cell('room') || 'General'}.`);
    seen.add(key);

    if (errors.length > before || !kind || !tier || !status) return;

    const common = {
      name: name(rawName),
      room: room(cell('room') || 'General'),
      ...(cell('group') && { group: group(cell('group')) }),
      ...(description && { description }),
      tier,
      energy: parseEnergy(cell('energy')),
      status: status.status,
      ...(lastDone !== undefined && { lastDone }),
      ...(cell('owner') && { ownerName: cell('owner') }),
    };
    tends.push(kind === 'habit' ? { ...common, kind, frequencyDays: freq } : { ...common, kind, ...(status.done && { completed: true }) });
  });

  return { tends: errors.length ? [] : tends, errors };
}

const TIER_EXPORT: Record<EffortTier, string> = {
  sloth: '🦥 Sloth Tier',
  tortoise: '🐢 Tortoise Tier',
  bee: '🐝 Worker Bee Tier',
  elephant: '🐘 Elephant Tier',
};

const KIND_EXPORT: Record<TendKind, string> = { habit: 'Habit', quest: 'Quest' };

export function toTendsCsv(tends: Tend[], members: Member[]): string {
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  return Papa.unparse({
    fields: ['Name', 'Room', 'Group', 'Kind', 'Description', 'Effort Tier', 'Energy Type', 'Frequency (Days)', 'Last Done Date', 'Permanent Owner', 'Status'],
    data: tends.map((t) => [
      t.name,
      t.room,
      t.group ?? '',
      KIND_EXPORT[t.kind],
      t.description ?? '',
      TIER_EXPORT[t.tier],
      t.energy.join(', '),
      t.frequencyDays ?? '',
      t.lastDone != null ? dayKey(t.lastDone) : '',
      (t.ownerId && memberName.get(t.ownerId)) ?? '',
      t.completedAt != null ? 'Done' : t.status === 'paused' ? 'Paused' : 'Active',
    ]),
  });
}
