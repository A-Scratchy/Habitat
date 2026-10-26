import Dexie, { type EntityTable } from 'dexie';
import type { Member, Task, Win } from '../domain/types';

type HabitatDexie = Dexie & {
  tasks: EntityTable<Task, 'id'>;
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
  return d;
}

/**
 * The local database for the habitat this device is in. Each habitat gets its own, so someone
 * else signing in on the same browser never sees another household's pack or chores.
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
