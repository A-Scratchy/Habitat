import { useState } from 'react';
import { restartQuest } from '../data/actions';
import { browse, completedQuests, NO_ROOM, pickRandom } from '../domain/selection';
import { ENERGY, ENERGY_ORDER, KINDS, OUT_AND_ABOUT, roomIcon, TIER_ORDER, TIERS, type EffortTier, type EnergyTag, type TendKind } from '../domain/types';
import { needOf } from '../domain/urgency';
import { useHabitat } from './habitat';
import { TendCard } from './TendCard';

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
export function Browse({ kind, initialRoomId }: { kind: TendKind; initialRoomId?: string }) {
  const { tends, ctx, rooms: allRooms, roomById, roomName } = useHabitat();
  const [roomId, setRoomId] = useState(initialRoomId);
  const [query, setQuery] = useState('');
  const [tiers, setTiers] = useState<EffortTier[]>([]);
  const [energy, setEnergy] = useState<EnergyTag[]>([]);
  const [surpriseId, setSurpriseId] = useState<string>();
  const copy = COPY[kind];

  const filter = { query, tiers, energy };
  const everything = browse(tends, ctx, kind, filter, roomName);
  // Rooms in your chosen order, showing only the ones with something open of this kind.
  const rooms: { id: string; name: string; icon: string }[] = allRooms
    .filter((r) => everything.some((t) => t.roomId === r.id))
    .map((r) => ({ id: r.id, name: r.name, icon: roomIcon(r) }));
  if (everything.some((t) => !t.roomId)) rooms.push({ id: NO_ROOM, ...OUT_AND_ABOUT });
  // Habits start from "Where are you?"; quests show the whole list, with rooms as an optional filter.
  const choosingRoom = kind === 'habit' && !roomId && !query.trim();
  const results = choosingRoom ? [] : browse(tends, ctx, kind, { ...filter, roomId }, roomName);
  const room = roomId === NO_ROOM ? OUT_AND_ABOUT : roomId ? { name: roomById.get(roomId)?.name ?? '', icon: roomIcon(roomById.get(roomId)) } : undefined;
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

      {kind === 'quest' && rooms.length > 0 && (
        <div className="chips" role="group" aria-label="Filter by room (optional)">
          <button className={`chip${!roomId ? ' on' : ''}`} aria-pressed={!roomId} onClick={() => setRoomId(undefined)}>
            All rooms
          </button>
          {rooms.map((r) => (
            <button key={r.id} className={`chip${roomId === r.id ? ' on' : ''}`} aria-pressed={roomId === r.id} onClick={() => setRoomId(roomId === r.id ? undefined : r.id)}>
              {r.icon} {r.name}
            </button>
          ))}
        </div>
      )}

      {choosingRoom ? (
        <>
          <h3 className="section-title">Where are you?</h3>
          {rooms.length === 0 && <p className="empty">{kind === 'habit' ? 'No habits yet. Add some in the Tending tab.' : 'No open quests. Add one in the Tending tab.'}</p>}
          <div className="rooms">
            {rooms.map((r) => {
              const here = everything.filter((t) => (r.id === NO_ROOM ? !t.roomId : t.roomId === r.id));
              const thirsty = here.filter((t) => ['thirsty', 'wilting'].includes(needOf(t, ctx.now))).length;
              const noun = here.length === 1 ? KINDS[kind].label.toLowerCase() : KINDS[kind].plural.toLowerCase();
              return (
                <button key={r.id} className="room-tile" onClick={() => setRoomId(r.id)}>
                  <span className="room-emoji" aria-hidden>
                    {r.icon}
                  </span>
                  <span className="room-name">{r.name}</span>
                  <span className="muted small">
                    {here.length} {noun}
                    {thirsty > 0 ? ` · ${thirsty} 💧` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {kind === 'habit' && (
            <div className="room-bar">
              <button className="link" onClick={() => setRoomId(undefined)}>
                ← All rooms
              </button>
              {room && (
                <span className="here">
                  {room.icon} {room.name}
                </span>
              )}
            </div>
          )}
          {results.length === 0 ? (
            <p className="empty">{kind === 'quest' && everything.length === 0 && !query.trim() ? 'No open quests for you right now 🗺️' : copy.empty}</p>
          ) : (
            <div className="cards">
              {results.map((t) => (
                <TendCard key={t.id} tend={t} />
              ))}
            </div>
          )}
        </>
      )}

      {kind === 'quest' && <CompletedShelf />}
    </section>
  );
}

/** Finished quests, kept like trophies. Restart puts one back on the open list. */
function CompletedShelf() {
  const { tends, roomName } = useHabitat();
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
               <span className="muted small"> · {q.roomId ? roomName(q.roomId) : OUT_AND_ABOUT.name} · {new Date(q.completedAt!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
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
