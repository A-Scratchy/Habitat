import { describe, expect, it } from 'vitest';
import type { Habit, Quest } from '../domain/types';
import { ApiError } from './api';
import { alreadyDone, keepLocalWinFields, memberFromServer, patchToServer, refused, server, tendFromServer, tendToServer, winFromServer } from './remote';

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
  schedule: 'Every' as string | null,
  frequencyDays: 2 as number | null,
  status: 'Active',
  completedAt: null,
  ownerMemberId: 'robin',
  openToEveryone: null,
  availableTo: [],
  claimMemberId: 'sam',
  claimDay: '2026-10-27',
  bountyAcorns: null as number | null,
  bountyPostedAt: null as string | null,
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
      schedule: 'every',
      frequencyDays: 2,
      status: 'active',
      ownerId: 'robin',
      claim: { memberId: 'sam', day: '2026-10-27' },
      lastDone: Date.parse('2026-10-25T09:30:00Z'),
    });
  });

  it('reads quests: open to everyone or particular members, with or without a room', () => {
    const base = { ...serverTend, kind: 'Quest', schedule: null, frequencyDays: null, ownerMemberId: null, claimMemberId: null, claimDay: null, lastDoneAt: null };
    const everyone = tendFromServer({ ...base, roomId: null, openToEveryone: true }) as Quest;
    expect(everyone.availableTo).toBe('everyone');
    expect(everyone.roomId).toBeUndefined();
    const some = tendFromServer({ ...base, openToEveryone: false, availableTo: ['sam'], completedAt: '2026-10-26T12:00:00Z' }) as Quest;
    expect(some.availableTo).toEqual(['sam']);
    expect(some.completedAt).toBe(Date.parse('2026-10-26T12:00:00Z'));
  });

  it('refuses values it does not know, and habits missing their room or schedule', () => {
    expect(() => tendFromServer({ ...serverTend, tier: 'Hamster' })).toThrow(/Hamster/);
    expect(() => tendFromServer({ ...serverTend, frequencyDays: null })).toThrow(/how often/);
    expect(() => tendFromServer({ ...serverTend, schedule: null })).toThrow(/schedule/);
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
      schedule: 'Every',
      frequencyDays: 2,
      ownerMemberId: 'robin',
      openToEveryone: null,
      availableTo: null,
      seedLastDoneAt: '2026-10-25T09:30:00.000Z',
    });
    const quest: Quest = { id: 'q', kind: 'quest', name: 'Go to tip', tier: 'elephant', impact: 'small', energy: [], status: 'active', availableTo: ['sam'] };
    expect(tendToServer(quest)).toMatchObject({ kind: 'Quest', roomId: null, schedule: null, frequencyDays: null, ownerMemberId: null, openToEveryone: false, availableTo: ['sam'] });
  });

  it('patches send server values, and clearing a field sends null', () => {
    expect(patchToServer({ tier: 'sloth', group: undefined, energy: ['sensory'] })).toEqual({ tier: 'Sloth', group: null, energy: ['Sensory'] });
    expect(() => patchToServer({ kind: 'quest' })).toThrow();
  });

  it('wins: the first member did it, the rest helped', () => {
    const w = winFromServer({ id: 'w', tendId: 'h1', tendName: 'Wipe sink', roomId: 'kitchen', roomName: 'Kitchen', tier: 'Bee', bountyAcorns: 0, at: '2026-10-27T08:00:00Z', memberIds: ['robin', 'sam'], deletedAt: null });
    expect(() => winFromServer({ id: 'w', tendId: 'h1', tendName: 'x', roomId: null, roomName: null, tier: 'Giraffe', bountyAcorns: 0, at: '2026-10-27T08:00:00Z', memberIds: ['robin'], deletedAt: null })).toThrow();
    expect(w).toEqual({ id: 'w', tendId: 'h1', tendName: 'Wipe sink', roomId: 'kitchen', room: 'Kitchen', tier: 'bee', memberId: 'robin', helperIds: ['sam'], at: Date.parse('2026-10-27T08:00:00Z') });
  });

  it('bounties come with when they went up, and a win says what it paid', () => {
    expect(tendFromServer({ ...serverTend, bountyAcorns: 10, bountyPostedAt: '2026-10-27T08:00:00Z' }).bounty).toEqual({ acorns: 10, postedAt: Date.parse('2026-10-27T08:00:00Z') });
    expect(() => tendFromServer({ ...serverTend, bountyAcorns: 10 })).toThrow(/bounty/);
    const paid = { id: 'w', tendId: 'h1', tendName: 'x', roomId: null, roomName: null, tier: 'Bee', at: '2026-10-27T08:00:00Z', memberIds: ['robin'], deletedAt: null };
    expect(winFromServer({ ...paid, bountyAcorns: 10 }).bounty).toBe(10);
    expect(winFromServer({ ...paid, bountyAcorns: 0 })).not.toHaveProperty('bounty');
  });

  it('members keep their chosen sound, and an unknown one is refused', () => {
    const m = { id: 'm', name: 'Robin', animal: '🦊', isUser: true, deletedAt: null };
    expect(memberFromServer({ ...m, sound: 'Birdsong' })).toEqual({ id: 'm', name: 'Robin', animal: '🦊', sound: 'birdsong' });
    expect(memberFromServer({ ...m, sound: 'None' }).sound).toBe('none');
    expect(() => memberFromServer({ ...m, sound: 'Klaxon' })).toThrow(/Klaxon/);
  });

  it('habits done when needed have no frequency, either way', () => {
    const mop = tendFromServer({ ...serverTend, schedule: 'WhenNeeded', frequencyDays: null });
    expect(mop).toMatchObject({ kind: 'habit', schedule: 'whenNeeded' });
    expect(mop.frequencyDays).toBeUndefined();
    expect(tendToServer(mop)).toMatchObject({ schedule: 'WhenNeeded', frequencyDays: null });
    expect(patchToServer({ schedule: 'whenNeeded', frequencyDays: undefined })).toEqual({ schedule: 'WhenNeeded', frequencyDays: null });
  });
});

describe('outbox', () => {
  const win = { id: 'w1', tendId: 'h1', tendName: 'Wipe sink', tier: 'bee' as const, memberId: 'sam', at: 1000 };

  it('keeps what only this device knows about its own wins when the server copy arrives', () => {
    expect(keepLocalWinFields(win, { ...win, prevLastDone: 500, completedQuest: true })).toEqual({ ...win, prevLastDone: 500, completedQuest: true });
    // Never done before is worth keeping too: undo puts it back to "never".
    expect(keepLocalWinFields(win, { ...win, prevLastDone: undefined })).toHaveProperty('prevLastDone', undefined);
    expect(keepLocalWinFields(win, undefined)).toEqual(win);
  });

  it('tells a refusal from the habitat being unreachable, waking or signed out', () => {
    expect(refused(new ApiError(400, 'bad'))).toBe(true);
    expect(refused(new ApiError(404, 'gone'))).toBe(true);
    expect([0, 401, 408, 429, 500, 503].map((s) => refused(new ApiError(s, '')))).toEqual([false, false, false, false, false, false]);
  });

  it('counts removing something already gone as done', () => {
    expect(alreadyDone({ method: 'DELETE' }, new ApiError(404, ''))).toBe(true);
    expect(alreadyDone({ method: 'PUT' }, new ApiError(404, ''))).toBe(false);
  });

  it('records each change as a request the server can take later', () => {
    expect(server.putWin(win, ['sam', 'alex'])).toEqual({ method: 'PUT', path: '/wins/w1', what: 'Ticking off “Wipe sink”', body: { tendId: 'h1', memberIds: ['sam', 'alex'], at: new Date(1000).toISOString() } });
    expect(server.deleteWin(win)).toEqual({ method: 'DELETE', path: '/wins/w1', what: 'Undoing “Wipe sink”' });
  });
});
