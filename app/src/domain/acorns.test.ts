import { describe, expect, it } from 'vitest';
import { berries, bountyFor, bountyPicks, onBoard, purse } from './acorns';
import type { Habit, Win } from './types';

const win = (over: Partial<Win>): Win => ({ id: 'w', tendId: 'h', tendName: 'h', tier: 'bee', memberId: 'sam', at: 0, ...over });

describe('acorns and berries', () => {
  const wins = [
    win({ tier: 'elephant', memberId: 'sam', helperIds: ['alex'], bounty: 10 }), // 15 split: 7.5 each
    win({ tier: 'sloth', memberId: 'alex' }), // 1 to Alex
    win({ tier: 'bee', memberId: 'sam' }), // 3 to Sam
  ];
  const earlier = { tiers: [{ tier: 'tortoise' as const, count: 2 }], shares: [{ memberId: 'sam', tier: 'tortoise' as const, share: 1.5 }], bounties: [{ memberId: 'sam', acorns: 4 }] };

  it('fills each purse with its share of effort and bounties, older wins included', () => {
    expect(purse(wins, [], 'sam', undefined)).toBe(11); // 10.5 rounds up
    expect(purse(wins, [], 'alex', undefined)).toBe(9); // 8.5 rounds up
    expect(purse(wins, [], 'sam', earlier)).toBe(18); // + 1.5 × 2 + 4
  });

  it('takes off what was spent on gifts, from the sender only', () => {
    const hug = { id: 'g', kind: 'hug' as const, fromId: 'sam', toId: 'alex', acorns: 3, sentAt: 0 };
    expect([purse(wins, [hug], 'sam', undefined), purse(wins, [hug], 'alex', undefined)]).toEqual([8, 9]);
  });

  it('fills the pack’s jar with every win’s effort, bounties aside', () => {
    expect(berries(wins, undefined)).toBe(9);
    expect(berries(wins, earlier)).toBe(13);
  });

  it('offers bounties as multiples of what the job normally earns', () => {
    expect(bountyPicks('bee').map((p) => p.acorns)).toEqual([3, 6, 9]);
    expect(bountyPicks('elephant').map((p) => p.acorns)).toEqual([5, 10, 15]);
  });

  it('pays a bounty only for doing it after it went up', () => {
    const t = { id: 'h', bounty: { acorns: 10, postedAt: 100 } } as Habit;
    expect([bountyFor(t, 99), bountyFor(t, 100)]).toEqual([0, 10]);
    expect(onBoard([{ ...t, id: 'b', bounty: { acorns: 5, postedAt: 200 } }, t, { id: 'x' } as Habit]).map((x) => x.id)).toEqual(['h', 'b']);
  });
});
