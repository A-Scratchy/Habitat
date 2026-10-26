import { dayKey, DAY, timeOfDay } from '../domain/dates';
import { winMembers } from '../domain/selection';
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
          <strong>{who}</strong> looked after <strong>{win.tendName}</strong>
        </p>
        <p className="muted small">
          {win.room} · {timeOfDay(win.at)}
        </p>
      </div>
    </li>
  );
}

/** The Watering Hole: today's wins (and yesterday's, folded), newest first. */
export function WinsFeed() {
  const { wins, ctx } = useHabitat();
  const sorted = [...wins].sort((a, b) => b.at - a.at);
  const today = sorted.filter((w) => dayKey(w.at) === dayKey(ctx.now));
  const yesterday = sorted.filter((w) => dayKey(w.at) === dayKey(ctx.now - DAY));

  return (
    <>
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
    </>
  );
}
