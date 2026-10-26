import { readConnection } from '../data/api';
import { habitatHealth, HEALTH, packTotals, roomHealth, type Health } from '../domain/health';
import { roomIcon, type Room } from '../domain/types';
import { useHabitat } from './habitat';
import { WinsFeed } from './WinsFeed';

/** A soft bar for a health score; no bar when there's nothing to judge yet. */
function HealthBar({ health }: { health: Health }) {
  if (health.score === undefined) return null;
  return (
    <div className={`health-bar ${health.level}`} role="img" aria-label={`${Math.round(health.score * 100)}% healthy`}>
      <span style={{ width: `${Math.max(4, Math.round(health.score * 100))}%` }} />
    </div>
  );
}

function needsLine(h: Health): string {
  const parts = [h.thirsty && `${h.thirsty} thirsty`, h.wilting && `${h.wilting} wilting`].filter(Boolean);
  return parts.length ? parts.join(' · ') : HEALTH[h.level].label;
}

/**
 * The Habitat: the whole home at a glance. What the pack has done, how every room is doing
 * (overdue habits weighted by ecological impact), and today's wins. Tapping a room opens its habits.
 */
export function Overview({ onOpenRoom }: { onOpenRoom(room: Room): void }) {
  const { rooms, tends, wins, ctx } = useHabitat();
  const overall = habitatHealth(tends, ctx.now);
  const totals = packTotals(wins, ctx.now);
  const name = readConnection()?.householdName ?? 'Our Habitat';

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>{name}</h2>
        <p className="muted">
          {HEALTH[overall.level].emoji} {overall.level === 'resting' || overall.level === 'unknown' ? HEALTH[overall.level].label : `The habitat is ${HEALTH[overall.level].label.toLowerCase()}`}
        </p>
        <HealthBar health={overall} />
      </header>

      <div className="pack-totals" aria-label="What the pack did">
        {(
          [
            ['Today', totals.today],
            ['Yesterday', totals.yesterday],
            ['This week', totals.week],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="panel total">
            <strong>{n}</strong>
            <span className="muted small">{label}</span>
          </div>
        ))}
      </div>
      <p className="muted small center-text">Things the pack looked after, together 🐾</p>

      <h3 className="section-title">Rooms</h3>
      {rooms.length === 0 ? (
        <p className="empty">No rooms yet. Add them in the Tending tab.</p>
      ) : (
        <div className="rooms">
          {rooms.map((room) => {
            const h = roomHealth(room, tends, ctx.now);
            return (
              <button key={room.id} className={`room-tile health-${h.level}`} onClick={() => onOpenRoom(room)}>
                <span className="room-top">
                  <span className="room-emoji" aria-hidden>
                    {roomIcon(room)}
                  </span>
                  <span className="room-health" title={HEALTH[h.level].label}>
                    {HEALTH[h.level].emoji}
                  </span>
                </span>
                <span className="room-name">{room.name}</span>
                <HealthBar health={h} />
                <span className="muted small">{needsLine(h)}</span>
              </button>
            );
          })}
        </div>
      )}

      <h3 className="section-title">The Watering Hole · today’s wins</h3>
      <WinsFeed />
    </section>
  );
}
