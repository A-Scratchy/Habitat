import Dexie, { type EntityTable } from 'dexie';
import type { Member, Task, Win } from '../domain/types';

export const db = new Dexie('household-ecosystem') as Dexie & {
  tasks: EntityTable<Task, 'id'>;
  members: EntityTable<Member, 'id'>;
  wins: EntityTable<Win, 'id'>;
};

db.version(1).stores({
  tasks: 'id, status, room',
  members: 'id',
  wins: 'id, at',
});

export const newId = () => crypto.randomUUID();
