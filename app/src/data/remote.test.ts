import { describe, expect, it } from 'vitest';
import type { Habit, Quest } from '../domain/types';
import { memberFromServer, patchToServer, tendFromServer, tendToServer, winFromServer } from './remote';

const serverTend = {
  id: 'h1',
  kind: 'Habit',
  name: 'Wipe sink',
  roomId: 'kitchen',
  group: null,
  description: null,
  tier: 'Bee',
  impact: 'Large',
  energy: ['Micro', 'Brainless'],
  frequencyDays: 2,
  status: 'Active',
  completedAt: null,
  ownerMemberId: 'robin',
  openToEveryone: null,
  availableTo: [],
  claimMemberId: 'sam',
  claimDay: '2026-10-27',
  lastDoneAt: '2026-10-25T09:30:00+00:00',
  deletedAt: null,
};

describe('server shapes', () => {
  it('reads a habit strictly, with app names for its values', () => {
    expect(tendFromServer(serverTend)).toEqual<Habit>({
      id: 'h1',
      kind: 'habit',
      name: 'Wipe sink',
      roomId: 'kitchen',
      tier: 'bee',
      impact: 'large',
      energy: ['micro', 'brainless'],
      frequencyDays: 2,
      status: 'active',
      ownerId: 'robin',
      claim: { memberId: 'sam', day: '2026-10-27' },
      lastDone: Date.parse('2026-10-25T09:30:00Z'),
    });
  });

  it('reads quests: open to everyone or particular members, with or without a room', () => {
    const base = { ...serverTend, kind: 'Quest', frequencyDays: null, ownerMemberId: null, claimMemberId: null, claimDay: null, lastDoneAt: null };
    const everyone = tendFromServer({ ...base, roomId: null, openToEveryone: true }) as Quest;
    expect(everyone.availableTo).toBe('everyone');
    expect(everyone.roomId).toBeUndefined();
    const some = tendFromServer({ ...base, openToEveryone: false, availableTo: ['sam'], completedAt: '2026-10-26T12:00:00Z' }) as Quest;
    expect(some.availableTo).toEqual(['sam']);
    expect(some.completedAt).toBe(Date.parse('2026-10-26T12:00:00Z'));
  });

  it('refuses values it does not know, and habits missing their room or schedule', () => {
    expect(() => tendFromServer({ ...serverTend, tier: 'Hamster' })).toThrow(/Hamster/);
    expect(() => tendFromServer({ ...serverTend, frequencyDays: null })).toThrow(/schedule/);
    expect(() => tendFromServer({ ...serverTend, kind: 'Quest', openToEveryone: null })).toThrow(/who can take it on/);
  });

  it('round-trips a tend to the server shape', () => {
    const habit = tendFromServer(serverTend);
    expect(tendToServer(habit)).toMatchObject({
      kind: 'Habit',
      tier: 'Bee',
      impact: 'Large',
      energy: ['Micro', 'Brainless'],
      status: 'Active',
      frequencyDays: 2,
      ownerMemberId: 'robin',
      openToEveryone: null,
      availableTo: null,
      seedLastDoneAt: '2026-10-25T09:30:00.000Z',
    });
    const quest: Quest = { id: 'q', kind: 'quest', name: 'Go to tip', tier: 'elephant', impact: 'small', energy: [], status: 'active', availableTo: ['sam'] };
    expect(tendToServer(quest)).toMatchObject({ kind: 'Quest', roomId: null, frequencyDays: null, ownerMemberId: null, openToEveryone: false, availableTo: ['sam'] });
  });

  it('patches send server values, and clearing a field sends null', () => {
    expect(patchToServer({ tier: 'sloth', group: undefined, energy: ['sensory'] })).toEqual({ tier: 'Sloth', group: null, energy: ['Sensory'] });
    expect(() => patchToServer({ kind: 'quest' })).toThrow();
  });

  it('wins: the first member did it, the rest helped', () => {
    const w = winFromServer({ id: 'w', tendId: 'h1', tendName: 'Wipe sink', roomId: 'kitchen', roomName: 'Kitchen', at: '2026-10-27T08:00:00Z', memberIds: ['robin', 'sam'], deletedAt: null });
    expect(w).toEqual({ id: 'w', tendId: 'h1', tendName: 'Wipe sink', roomId: 'kitchen', room: 'Kitchen', memberId: 'robin', helperIds: ['sam'], at: Date.parse('2026-10-27T08:00:00Z') });
  });

  it('members keep their chosen sound, and an unknown one is refused', () => {
    const m = { id: 'm', name: 'Robin', animal: '🦊', isUser: true, deletedAt: null };
    expect(memberFromServer({ ...m, sound: 'Birdsong' })).toEqual({ id: 'm', name: 'Robin', animal: '🦊', sound: 'birdsong' });
    expect(memberFromServer({ ...m, sound: 'None' }).sound).toBe('none');
    expect(() => memberFromServer({ ...m, sound: 'Klaxon' })).toThrow(/Klaxon/);
  });
});
