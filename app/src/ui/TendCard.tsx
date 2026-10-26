import { useCallback, useState, type MouseEvent } from 'react';
import { claimToday, releaseClaim } from '../data/actions';
import { claimedToday, groupMates, isHandsOff, lastDoneLabel } from '../domain/selection';
import { ENERGY, IMPACTS, KINDS, TIERS, type Tend } from '../domain/types';
import { NEEDS, needOf } from '../domain/urgency';
import { useHabitat } from './habitat';
import { TendSheet } from './TendSheet';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function TendCard({ tend, big = false }: { tend: Tend; big?: boolean }) {
  const { tends, ctx, me, memberById, complete, roomName } = useHabitat();
  const [leaving, setLeaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const owner = tend.ownerId ? memberById.get(tend.ownerId) : undefined;
  const claimer = claimedToday(tend, ctx.now) ? memberById.get(tend.claim!.memberId) : undefined;
  const handsOff = isHandsOff(tend, ctx);
  const mates = handsOff ? [] : groupMates(tends, tend, ctx);
  // Only habits have a schedule, so only habits can be thirsty.
  const need = tend.kind === 'habit' ? NEEDS[needOf(tend, ctx.now)] : undefined;
  const tier = TIERS[tend.tier];
  const last = lastDoneLabel(tend, ctx.now);

  // Fade out, log, then fade back in: lists that keep done tends (Forage) just re-sort it.
  const finish = (ids: string[]) => {
    setLeaving(true);
    setTimeout(
      () => void complete(ids).finally(() => setLeaving(false)),
      reducedMotion() ? 0 : 220,
    );
  };

  let note: string | undefined;
  if (claimer && claimer.id !== me?.id) note = `${claimer.animal} ${claimer.name}'s on this today`;
  else if (claimer) note = '🌟 You said you’d do this today';
  else if (owner && owner.id !== me?.id) note = `${owner.animal} ${owner.name}'s zone`;
  else if (owner) note = '🌟 Your zone';

  // When it's someone else's job, logging defaults to crediting them.
  const defaultWho = [(handsOff ? (claimer ?? owner)?.id : undefined) ?? me?.id].filter((id): id is string => !!id);

  const openSheet = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return;
    setSheetOpen(true);
  };

  return (
    <>
      <article
        className={`card tier-${tend.tier}${big ? ' big' : ''}${leaving ? ' leaving' : ''}${handsOff ? ' hands-off' : ''}`}
        onClick={openSheet}
      >
        <div className="card-top">
          <h3>{tend.name}</h3>
          {need && (
            <span className="need" title={need.label}>
              {need.emoji} <span className="need-label">{need.label}</span>
            </span>
          )}
          <button className="more" onClick={() => setSheetOpen(true)} aria-label={`More for ${tend.name}`}>
            ⋯
          </button>
        </div>
        <p className="meta">
          {tend.kind === 'quest' && <span className="tag">{KINDS.quest.emoji} Quest</span>}
          <span>{roomName(tend.roomId)}</span>
          {tend.impact === 'large' && (
            <span className="tag" title={IMPACTS.large.hint}>
              {IMPACTS.large.emoji} Big impact
            </span>
          )}
          <span className="tier-badge" title={tier.hint}>
            {tier.emoji} {tier.label}
          </span>
          {tend.energy.map((e) => (
            <span key={e} className="tag" title={ENERGY[e].hint}>
              {ENERGY[e].emoji} {ENERGY[e].label}
            </span>
          ))}
          {(tend.kind === 'habit' || last) && <span className="last">🕰️ {last ? `Done ${last}` : 'Not logged yet'}</span>}
          {tend.description && (
            <span className="tag" title="Has instructions: tap the card to read them">
              📝 How to
            </span>
          )}
        </p>
        {note && <p className="note">{note}</p>}
        {!handsOff && (
          <div className="actions">
            <button className="btn-done" onClick={() => finish([tend.id])} disabled={leaving}>
              Done! 🎉
            </button>
            {mates.length > 0 && (
              <button className="btn-soft" onClick={() => finish([tend.id, ...mates.map((m) => m.id)])} disabled={leaving}>
                All {tend.group} ({mates.length + 1}) 🚀
              </button>
            )}
            {claimer ? (
              <button className="link" onClick={() => void releaseClaim(tend.id)}>
                Let it go
              </button>
            ) : (
              me && (
                <button className="link" onClick={() => void claimToday(tend.id, me.id)}>
                  I’ll do this today
                </button>
              )
            )}
          </div>
        )}
      </article>
      {sheetOpen && <TendSheet tend={tend} defaultWho={defaultWho} onClose={closeSheet} />}
    </>
  );
}
