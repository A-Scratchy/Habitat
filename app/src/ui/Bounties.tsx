import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { claimToday, postBounty, releaseClaim, removeBounty } from '../data/actions';
import { db } from '../data/db';
import { DEFAULT_BOUNTY_MULTIPLE, berries, bountyPicks, onBoard, purse, readEarlier } from '../domain/acorns';
import { claimedToday } from '../domain/selection';
import { TIER_ACORNS } from '../domain/report';
import { OUT_AND_ABOUT, TIERS, type Tend } from '../domain/types';
import { useHabitat } from './habitat';

/** All-time totals: whoever is using this device's acorns, and the pack's berries. Undefined while loading. */
export function useTotals(): { acorns?: number; berries: number } | undefined {
  const { me } = useHabitat();
  return useLiveQuery(async () => {
    const [wins, gifts, earlier] = await Promise.all([db.wins.toArray(), db.gifts.toArray(), db.meta.get('earlier')]);
    const e = readEarlier(earlier?.value);
    return { ...(me && { acorns: purse(wins, gifts, me.id, e) }), berries: berries(wins, e) };
  }, [me?.id]);
}

/** The header's purse: private to whoever is using this device. */
export function AcornPurse({ onOpen }: { onOpen(): void }) {
  const totals = useTotals();
  if (totals?.acorns === undefined) return null;
  return (
    <button className="purse" onClick={onOpen} aria-label={`Your acorns: ${totals.acorns}`} title="Your acorns. Only you see these.">
      🌰 {totals.acorns.toLocaleString()}
    </button>
  );
}

/** The pack's shared jar. */
export function BerryJar() {
  const totals = useTotals();
  if (!totals) return null;
  return (
    <p className="muted small center-text">
      🫐 <strong>{totals.berries.toLocaleString()}</strong> berries in the pack’s jar, from everything looked after together
    </p>
  );
}

/** The bounty board: important things nobody can do right now. Anyone can pick one up. */
export function BountyBoard() {
  const { tends, me, memberById, roomName, ctx, complete } = useHabitat();
  const board = onBoard(tends);
  return (
    <>
      <h3 className="section-title">📜 Bounty board</h3>
      {board.length === 0 ? (
        <p className="empty">No bounties up. Anything important that can’t be done right now can go up from its menu.</p>
      ) : (
        <div className="stack">
          {board.map((t) => {
            const claimer = claimedToday(t, ctx.now) ? memberById.get(t.claim!.memberId) : undefined;
            return (
              <div key={t.id} className="panel bounty">
                <div className="bounty-top">
                  <strong>{t.name}</strong>
                  <span className="bounty-reward">🌰 {t.bounty!.acorns}</span>
                </div>
                <span className="muted small">
                  {t.roomId ? roomName(t.roomId) : OUT_AND_ABOUT.name}
                  {claimer && (claimer.id === me?.id ? ' · 🌟 You picked this up' : ` · ${claimer.animal} ${claimer.name} picked this up`)}
                </span>
                {me && (
                  <div className="actions">
                    {!claimer && (
                      <button className="btn-soft" onClick={() => void claimToday(t.id, me.id)}>
                        🙋 Pick it up
                      </button>
                    )}
                    {claimer?.id === me.id && (
                      <button className="link" onClick={() => void releaseClaim(t.id)}>
                        Let it go
                      </button>
                    )}
                    <button className="btn-done" onClick={() => void complete([t.id])}>
                      Done! 🎉
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** In a habit or quest's menu: put it on the bounty board, change the reward, or take it down. The menu closes once that's done. */
export function BountyPanel({ tend, onDone }: { tend: Tend; onDone(): void }) {
  const [open, setOpen] = useState(false);
  const [acorns, setAcorns] = useState(tend.bounty?.acorns ?? TIER_ACORNS[tend.tier] * DEFAULT_BOUNTY_MULTIPLE);
  const picks = bountyPicks(tend.tier);
  const [error, setError] = useState<string>();

  if (!open) {
    return (
      <button className="btn-soft wide" onClick={() => setOpen(true)}>
        {tend.bounty ? `📜 On the bounty board · 🌰 ${tend.bounty.acorns}` : '📜 Add to the bounty board'}
      </button>
    );
  }

  const run = async (action: () => Promise<void>) => {
    setError(undefined);
    try {
      await action();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Please try again.');
    }
  };

  return (
    <div className="panel stack">
      <p className="small">{tend.bounty ? 'Change the reward, or take it down.' : 'Important, but can’t be done right now? Anyone can pick it up. Whoever does it next gets the acorns.'}</p>
      <fieldset className="field">
        <legend>
          How many acorns? It normally earns {TIER_ACORNS[tend.tier]} ({TIERS[tend.tier].emoji} {TIERS[tend.tier].label})
        </legend>
        <div className="chips wrap">
          {picks.map(({ multiple, acorns: n }) => (
            <button key={multiple} type="button" className={`chip${acorns === n ? ' on' : ''}`} aria-pressed={acorns === n} onClick={() => setAcorns(n)}>
              🌰 {n} <span className="muted">×{multiple}</span>
            </button>
          ))}
          {/* A reward set before the effort changed stays choosable, rather than silently becoming another. */}
          {!picks.some((p) => p.acorns === acorns) && (
            <button type="button" className="chip on" aria-pressed>
              🌰 {acorns}
            </button>
          )}
        </div>
      </fieldset>
      <div className="actions">
        <button className="btn-done" onClick={() => void run(() => postBounty(tend.id, acorns))}>
          {tend.bounty ? 'Save' : 'Post bounty'}
        </button>
        {tend.bounty && (
          <button className="link danger" onClick={() => void run(() => removeBounty(tend.id))}>
            Take it down
          </button>
        )}
        <button className="link" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="small error-text">{error}</p>}
    </div>
  );
}
