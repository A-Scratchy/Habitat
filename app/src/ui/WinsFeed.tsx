import { dayKey, DAY, timeOfDay } from '../domain/dates';
import { OUT_AND_ABOUT, roomIcon, type Win } from '../domain/types';
import { useHabitat } from './habitat';

function WinRow({ win }: { win: Win }) {
  const { roomById } = useHabitat();
  // It's about the pack, never who: no names or personal animals, just what was looked after.
  const icon = win.roomId ? roomIcon(roomById.get(win.roomId)) : OUT_AND_ABOUT.icon;
  return (
    <li className="win">
      <span className="avatar" aria-hidden>
        {icon}
      </span>
      <div>
        <p>
          The pack looked after <strong>{win.tendName}</strong>
        </p>
        <p className="muted small">
          {win.room ?? OUT_AND_ABOUT.name} · {timeOfDay(win.at)}
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
