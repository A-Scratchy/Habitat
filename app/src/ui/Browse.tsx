import { useState } from 'react';
import { restartQuest } from '../data/actions';
import { browse, completedQuests, pickRandom } from '../domain/selection';
import { ENERGY, ENERGY_ORDER, KINDS, TIER_ORDER, TIERS, type EffortTier, type EnergyTag, type TendKind } from '../domain/types';
import { needOf } from '../domain/urgency';
import { useHabitat } from './habitat';
import { TendCard } from './TendCard';

const ROOM_EMOJI: [RegExp, string][] = [
  [/kitchen/i, '🍳'],
  [/bath|toilet|loo/i, '🛁'],
  [/garden|yard/i, '🌻'],
  [/bed/i, '🛏️'],
  [/pet|animal/i, '🐾'],
  [/hall|stair|landing/i, '🚪'],
  [/living|lounge/i, '🛋️'],
  [/dining/i, '🍽️'],
  [/general|house/i, '🏡'],
];
const roomEmoji = (room: string) => ROOM_EMOJI.find(([re]) => re.test(room))?.[1] ?? '🏠';

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

const COPY: Record<TendKind, { title: string; blurb: string; empty: string }> = {
  habit: {
    title: 'Foraging Menu',
    blurb: 'Every habit, most needed first. Choose how you’d like to help.',
    empty: 'No habits match that 🌳',
  },
  quest: {
    title: 'Quests',
    blurb: 'One-off adventures for when you fancy something different. Done quests go to the Completed shelf.',
    empty: 'No quests match that 🗺️',
  },
};

/** Room-by-room browsing of open habits (Forage) or open quests (Quests). */
export function Browse({ kind }: { kind: TendKind }) {
  const { tends, ctx } = useHabitat();
  const [room, setRoom] = useState<string>();
  const [query, setQuery] = useState('');
  const [tiers, setTiers] = useState<EffortTier[]>([]);
  const [energy, setEnergy] = useState<EnergyTag[]>([]);
  const [surpriseId, setSurpriseId] = useState<string>();
  const copy = COPY[kind];

  const filter = { query, tiers, energy };
  const everything = browse(tends, ctx, kind, filter);
  const rooms = [...new Set(everything.map((t) => t.room))].sort((a, b) => a.localeCompare(b));
  const choosingRoom = !room && !query.trim();
  const results = choosingRoom ? [] : browse(tends, ctx, kind, { ...filter, room });
  const surprise = everything.find((t) => t.id === surpriseId);

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>{copy.title}</h2>
        <p className="muted">{copy.blurb}</p>
      </header>

      {kind === 'quest' && (
        <>
          <button className="btn-done" disabled={everything.length === 0} onClick={() => setSurpriseId(pickRandom(everything, surpriseId)?.id)}>
            🎲 Pick a quest for me
          </button>
          {surprise && (
            <>
              <TendCard key={surprise.id} tend={surprise} big />
              <button className="link center" onClick={() => setSurpriseId(undefined)}>
                Put it back
              </button>
            </>
          )}
        </>
      )}

      <input
        className="search"
        type="search"
        placeholder={kind === 'habit' ? 'Search, e.g. “sink” or “feed”' : 'Search, e.g. “tip” or “shop”'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={`Search ${KINDS[kind].plural.toLowerCase()}`}
      />

      <div className="chips" role="group" aria-label="Effort and energy filters">
        {TIER_ORDER.map((t) => (
          <button key={t} className={`chip${tiers.includes(t) ? ' on' : ''}`} aria-pressed={tiers.includes(t)} onClick={() => setTiers(toggle(tiers, t))}>
            {TIERS[t].emoji} {TIERS[t].label}
          </button>
        ))}
        {ENERGY_ORDER.map((e) => (
          <button key={e} className={`chip${energy.includes(e) ? ' on' : ''}`} aria-pressed={energy.includes(e)} onClick={() => setEnergy(toggle(energy, e))}>
            {ENERGY[e].emoji} {ENERGY[e].label}
          </button>
        ))}
      </div>

      {choosingRoom ? (
        <>
          <h3 className="section-title">Where are you?</h3>
          {rooms.length === 0 && <p className="empty">{kind === 'habit' ? 'No habits yet. Add some in the Tending tab.' : 'No open quests. Add one in the Tending tab.'}</p>}
          <div className="rooms">
            {rooms.map((r) => {
              const here = everything.filter((t) => t.room === r);
              const thirsty = here.filter((t) => ['thirsty', 'wilting'].includes(needOf(t, ctx.now))).length;
              const noun = here.length === 1 ? KINDS[kind].label.toLowerCase() : KINDS[kind].plural.toLowerCase();
              return (
                <button key={r} className="room-tile" onClick={() => setRoom(r)}>
                  <span className="room-emoji" aria-hidden>
                    {roomEmoji(r)}
                  </span>
                  <span className="room-name">{r}</span>
                  <span className="muted small">
                    {here.length} {noun}
                    {thirsty > 0 ? ` · ${thirsty} 💧` : ''}
                  </span>
                </button>
              );
            })}
          </div>
          {kind === 'quest' && <CompletedShelf />}
        </>
      ) : (
        <>
          <div className="room-bar">
            <button className="link" onClick={() => setRoom(undefined)}>
              ← All rooms
            </button>
            {room && (
              <span className="here">
                {roomEmoji(room)} {room}
              </span>
            )}
          </div>
          {results.length === 0 ? (
            <p className="empty">{copy.empty}</p>
          ) : (
            <div className="cards">
              {results.map((t) => (
                <TendCard key={t.id} tend={t} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Finished quests, kept like trophies. Restart puts one back on the open list. */
function CompletedShelf() {
  const { tends } = useHabitat();
  const done = completedQuests(tends);
  if (done.length === 0) return null;
  return (
    <details className="room-group">
      <summary>
        <span>🏆 Completed</span>
        <span className="muted small">{done.length}</span>
      </summary>
      <ul className="admin-list">
        {done.map((q) => (
          <li key={q.id} className="completed-row">
            <span>
              {q.name}
              <span className="muted small"> · {q.room} · {new Date(q.completedAt!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
            </span>
            <button className="btn-soft" onClick={() => void restartQuest(q.id)}>
              Restart
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
