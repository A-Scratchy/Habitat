import { dayKey, DAY, timeOfDay } from '../domain/dates';
import { weekSummary, winMembers } from '../domain/selection';
import type { Win } from '../domain/types';
import { useHabitat } from './habitat';

function WinRow({ win }: { win: Win }) {
  const { memberById } = useHabitat();
  const pack = winMembers(win).map((id) => memberById.get(id));
  const names = pack.map((m) => m?.name ?? 'Someone');
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names.at(-1)}` : names[0];
  return (
    <li className="win">
      <span className="avatar" aria-hidden>
        {pack.map((m) => m?.animal ?? '🌱').join('')}
      </span>
      <div>
        <p>
          <strong>{who}</strong> looked after <strong>{win.taskName}</strong>
        </p>
        <p className="muted small">
          {win.room} · {timeOfDay(win.at)}
        </p>
      </div>
    </li>
  );
}

export function WateringHole() {
  const { wins, ctx } = useHabitat();
  const sorted = [...wins].sort((a, b) => b.at - a.at);
  const today = sorted.filter((w) => dayKey(w.at) === dayKey(ctx.now));
  const yesterday = sorted.filter((w) => dayKey(w.at) === dayKey(ctx.now - DAY));
  const week = weekSummary(wins, ctx.now);

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>The Watering Hole</h2>
        <p className="muted">Look how our pack looked after the habitat.</p>
      </header>

      <div className="panel week">
        {week.total === 0 ? (
          <p>A fresh week is starting. The habitat is resting 🌙</p>
        ) : (
          <>
            <p className="week-total">
              This week we’ve cared for the habitat <strong>{week.total}</strong> {week.total === 1 ? 'time' : 'times'} 🌿
            </p>
            <p className="muted small">
              {week.helpers > 1 ? `${week.helpers} of us helped · ` : ''}
              {week.rooms
                .slice(0, 4)
                .map(([room, n]) => `${room} ${n}`)
                .join(' · ')}
            </p>
          </>
        )}
      </div>

      <h3 className="section-title">Today</h3>
      {today.length === 0 ? (
        <p className="empty">Nothing logged yet today. That’s fine: there’s no hurry 🐌</p>
      ) : (
        <ul className="wins">
          {today.map((w) => (
            <WinRow key={w.id} win={w} />
          ))}
        </ul>
      )}

      {yesterday.length > 0 && (
        <details className="earlier">
          <summary>Yesterday ({yesterday.length})</summary>
          <ul className="wins">
            {yesterday.map((w) => (
              <WinRow key={w.id} win={w} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
