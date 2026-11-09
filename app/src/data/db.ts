import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_SOUND, type Gift, type Member, type Room, type Tend, type Win } from '../domain/types';

type HabitatDexie = Dexie & {
  rooms: EntityTable<Room, 'id'>;
  tends: EntityTable<Tend, 'id'>;
  members: EntityTable<Member, 'id'>;
  wins: EntityTable<Win, 'id'>;
  meta: EntityTable<{ key: string; value: string }, 'key'>;
  outbox: EntityTable<OutboxOp, 'seq'>;
  gifts: EntityTable<Gift, 'id'>;
};

/**
 * A change saved on this device that still has to reach the server, in the order it was made.
 * Stored as the request itself, so sending it later needs nothing else from the device.
 */
export interface OutboxOp {
  seq?: number;
  method: 'PUT' | 'PATCH' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  /** What it was, for the banner if the server says no: e.g. "Ticking off “Wipe sink”". */
  what: string;
}

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
  // Rooms became their own table. Existing room names map exactly onto new rooms (nothing guessed);
  // ecological impact starts at Medium for everything, as agreed, and can be changed per tend.
  d.version(3)
    .stores({
      rooms: 'id, name',
      tends: 'id, kind, status, roomId',
      members: 'id',
      wins: 'id, at',
    })
    .upgrade(async (tx) => {
      const tends = tx.table('tends');
      const names = [...new Set((await tends.toArray()).map((t: { room: string }) => t.room))].sort((a, b) => a.localeCompare(b));
      const rooms = names.map((name, i) => ({ id: crypto.randomUUID(), name, sortOrder: i }));
      await tx.table('rooms').bulkAdd(rooms);
      const idOf = new Map(rooms.map((r) => [r.name, r.id]));
      await tends.toCollection().modify((t: Record<string, unknown>) => {
        t.roomId = idOf.get(t.room as string);
        delete t.room;
        t.impact = 'medium';
      });
      await tx.table('wins').toCollection().modify((w: Record<string, unknown>) => {
        w.roomId = idOf.get(w.room as string) ?? '';
      });
    });
  // Quests now say who can take them on, replacing their owner one-for-one: a quest owned by
  // someone becomes available to just them; an unowned quest is open to everyone.
  d.version(4)
    .stores({
      rooms: 'id, name',
      tends: 'id, kind, status, roomId',
      members: 'id',
      wins: 'id, at',
    })
    .upgrade((tx) =>
      tx
        .table('tends')
        .toCollection()
        .modify((t: Record<string, unknown>) => {
          if (t.kind !== 'quest') return;
          t.availableTo = typeof t.ownerId === 'string' ? [t.ownerId] : 'everyone';
          delete t.ownerId;
        }),
    );
  // A connected habitat remembers how far it has synced, next to the data it describes.
  d.version(5).stores({
    rooms: 'id, name',
    tends: 'id, kind, status, roomId',
    members: 'id',
    wins: 'id, at',
    meta: 'key',
  });
  // Members choose a sound for finishing things. Everyone already here starts on the agreed default.
  d.version(6)
    .stores({
      rooms: 'id, name',
      tends: 'id, kind, status, roomId',
      members: 'id',
      wins: 'id, at',
      meta: 'key',
    })
    .upgrade((tx) =>
      tx
        .table('members')
        .toCollection()
        .modify((m: Record<string, unknown>) => {
          m.sound ??= DEFAULT_SOUND;
        }),
    );
  // Wins remember the effort tier they were done at, for reports. Older wins take their habit or
  // quest's tier; a win whose tend is gone can't be known, so it's dropped (a connected habitat
  // sends it again, tier and all, from the server).
  d.version(7)
    .stores({
      rooms: 'id, name',
      tends: 'id, kind, status, roomId',
      members: 'id',
      wins: 'id, at',
      meta: 'key',
    })
    .upgrade(async (tx) => {
      const tierOf = new Map((await tx.table('tends').toArray()).map((t: Tend) => [t.id, t.tier]));
      await tx
        .table('wins')
        .toCollection()
        .modify((w: Record<string, unknown>, ref: { value?: unknown }) => {
          if (w.tier) return;
          const tier = tierOf.get(w.tendId as string);
          if (tier) w.tier = tier;
          else delete ref.value;
        });
    });
  // Changes are saved here first and sent to the server from this queue, so taps never wait on it.
  d.version(8).stores({
    rooms: 'id, name',
    tends: 'id, kind, status, roomId',
    members: 'id',
    wins: 'id, at',
    meta: 'key',
    outbox: '++seq',
  });
  // Hugs, high-fives and thank yous, bought with acorns.
  d.version(9).stores({
    rooms: 'id, name',
    tends: 'id, kind, status, roomId',
    members: 'id',
    wins: 'id, at',
    meta: 'key',
    outbox: '++seq',
    gifts: 'id, toId',
  });
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
