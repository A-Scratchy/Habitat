import { useState } from 'react';
import { browse, ON_DEMAND } from '../domain/selection';
import { ENERGY, ENERGY_ORDER, TIER_ORDER, TIERS, type EffortTier, type EnergyTag } from '../domain/types';
import { needOf } from '../domain/urgency';
import { useHabitat } from './habitat';
import { TaskCard } from './TaskCard';

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
const roomEmoji = (room: string) => (room === ON_DEMAND ? '🃏' : (ROOM_EMOJI.find(([re]) => re.test(room))?.[1] ?? '🏠'));
const roomName = (room: string) => (room === ON_DEMAND ? 'On demand' : room);

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export function Browse() {
  const { tasks, ctx } = useHabitat();
  const [room, setRoom] = useState<string>();
  const [query, setQuery] = useState('');
  const [tiers, setTiers] = useState<EffortTier[]>([]);
  const [energy, setEnergy] = useState<EnergyTag[]>([]);

  const filter = { query, tiers, energy };
  const rooms = [...new Set(tasks.filter((t) => t.status === 'active').map((t) => t.room))].sort((a, b) => a.localeCompare(b));
  if (tasks.some((t) => t.status === 'onDemand')) rooms.push(ON_DEMAND);
  const choosingRoom = !room && !query.trim();
  const results = choosingRoom ? [] : browse(tasks, ctx, { ...filter, room });

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>Foraging Menu</h2>
        <p className="muted">Everything on the master list, most needed first. Choose how you’d like to help.</p>
      </header>

      <input
        className="search"
        type="search"
        placeholder="Search, e.g. “sink” or “feed”"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search tasks"
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
          <div className="rooms">
            {rooms.map((r) => {
              const here = browse(tasks, ctx, { ...filter, room: r });
              const thirsty = here.filter((t) => ['thirsty', 'wilting'].includes(needOf(t, ctx.now))).length;
              return (
                <button key={r} className="room-tile" onClick={() => setRoom(r)}>
                  <span className="room-emoji" aria-hidden>
                    {roomEmoji(r)}
                  </span>
                  <span className="room-name">{roomName(r)}</span>
                  <span className="muted small">
                    {here.length} {here.length === 1 ? 'task' : 'tasks'}
                    {thirsty > 0 ? ` · ${thirsty} 💧` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="room-bar">
            <button className="link" onClick={() => setRoom(undefined)}>
              ← All rooms
            </button>
            {room && (
              <span className="here">
                {roomEmoji(room)} {roomName(room)}
              </span>
            )}
          </div>
          {results.length === 0 ? (
            <p className="empty">No tasks match that 🌳</p>
          ) : (
            <div className="cards">
              {results.map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
