import { useCallback, useState, type MouseEvent } from 'react';
import { claimToday, releaseClaim } from '../data/actions';
import { claimedToday, groupMates, isHandsOff, lastDoneLabel } from '../domain/selection';
import { ENERGY, TIERS, type Task } from '../domain/types';
import { NEEDS, needOf } from '../domain/urgency';
import { useHabitat } from './habitat';
import { TaskSheet } from './TaskSheet';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function TaskCard({ task, big = false }: { task: Task; big?: boolean }) {
  const { tasks, ctx, me, memberById, complete } = useHabitat();
  const [leaving, setLeaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const owner = task.ownerId ? memberById.get(task.ownerId) : undefined;
  const claimer = claimedToday(task, ctx.now) ? memberById.get(task.claim!.memberId) : undefined;
  const handsOff = isHandsOff(task, ctx);
  const mates = handsOff ? [] : groupMates(tasks, task, ctx);
  const need = task.frequencyDays ? NEEDS[needOf(task, ctx.now)] : undefined;
  const tier = TIERS[task.tier];
  const last = lastDoneLabel(task, ctx.now);

  // Fade out, log, then fade back in: lists that keep done tasks (Forage) just re-sort it.
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
        className={`card tier-${task.tier}${big ? ' big' : ''}${leaving ? ' leaving' : ''}${handsOff ? ' hands-off' : ''}`}
        onClick={openSheet}
      >
        <div className="card-top">
          <h3>{task.name}</h3>
          {need && (
            <span className="need" title={need.label}>
              {need.emoji} <span className="need-label">{need.label}</span>
            </span>
          )}
          <button className="more" onClick={() => setSheetOpen(true)} aria-label={`More for ${task.name}`}>
            ⋯
          </button>
        </div>
        <p className="meta">
          <span>{task.room}</span>
          <span className="tier-badge" title={tier.hint}>
            {tier.emoji} {tier.label}
          </span>
          {task.energy.map((e) => (
            <span key={e} className="tag" title={ENERGY[e].hint}>
              {ENERGY[e].emoji} {ENERGY[e].label}
            </span>
          ))}
          <span className="last">🕰️ {last ? `Done ${last}` : 'Not logged yet'}</span>
        </p>
        {note && <p className="note">{note}</p>}
        {!handsOff && (
          <div className="actions">
            <button className="btn-done" onClick={() => finish([task.id])} disabled={leaving}>
              Done! 🎉
            </button>
            {mates.length > 0 && (
              <button className="btn-soft" onClick={() => finish([task.id, ...mates.map((m) => m.id)])} disabled={leaving}>
                All {task.group} ({mates.length + 1}) 🚀
              </button>
            )}
            {claimer ? (
              <button className="link" onClick={() => void releaseClaim(task.id)}>
                Let it go
              </button>
            ) : (
              me && (
                <button className="link" onClick={() => void claimToday(task.id, me.id)}>
                  I’ll do this today
                </button>
              )
            )}
          </div>
        )}
      </article>
      {sheetOpen && <TaskSheet task={task} defaultWho={defaultWho} onClose={closeSheet} />}
    </>
  );
}
