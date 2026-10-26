import Dexie, { type EntityTable } from 'dexie';
import type { Member, Tend, Win } from '../domain/types';

type HabitatDexie = Dexie & {
  tends: EntityTable<Tend, 'id'>;
  members: EntityTable<Member, 'id'>;
  wins: EntityTable<Win, 'id'>;
};

/** Used when sign-in isn't configured, and by the prototype before habitats existed. */
const LOCAL_ONLY = 'household-ecosystem';

function open(name: string): HabitatDexie {
  const d = new Dexie(name) as HabitatDexie;
  d.version(1).stores({
    tasks: 'id, status, room',
    members: 'id',
    wins: 'id, at',
  });
  // Habits and quests replaced "tasks". Old rows didn't say which kind they were, so rather than
  // guess they're dropped (nothing was launched); re-import with a Kind column. The pack stays.
  d.version(2)
    .stores({
      tasks: null,
      tends: 'id, kind, status, room',
      members: 'id',
      wins: 'id, at',
    })
    .upgrade((tx) => tx.table('wins').clear());
  return d;
}

/**
 * The local database for the habitat this device is in. Each habitat gets its own, so someone
 * else signing in on the same browser never sees another household's pack, habits or quests.
 * A live binding: every module's `db` follows selectHabitatDb().
 */
export let db: HabitatDexie = open(LOCAL_ONLY);

/** Switches to the given habitat's database (or the local-only one). Safe to call repeatedly. */
export function selectHabitatDb(householdId: string | undefined): void {
  const name = householdId ? `habitat-${householdId}` : LOCAL_ONLY;
  if (db.name === name) return;
  db.close();
  db = open(name);
}

export const newId = () => crypto.randomUUID();
