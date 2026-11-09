import { useState } from 'react';
import { matchesQuery, needsDoing, neverLogged } from '../domain/selection';
import { useHabitat } from './habitat';
import { TendCard } from './TendCard';

/** Forage: one long list of every habit that needs doing, across all rooms, most needed first. */
export function Forage() {
  const { tends, ctx, roomName } = useHabitat();
  const [query, setQuery] = useState('');
  const matches = (t: (typeof tends)[number]) => matchesQuery(t, query, roomName(t.roomId));
  const due = needsDoing(tends, ctx).filter(matches);
  const unlogged = neverLogged(tends, ctx).filter(matches);
  const searching = query.trim() !== '';

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>Forage</h2>
        <p className="muted">Everything that needs doing, all in one list, most needed first. Pick whatever you fancy.</p>
      </header>

      <input className="search" type="search" placeholder="Search, e.g. “sink” or “kitchen”" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search what needs doing" />

      {due.length === 0 ? (
        <p className="empty">{searching ? 'Nothing that needs doing matches that 🍄' : 'Nothing is thirsty or wilting. The habitat is flourishing 🌳'}</p>
      ) : (
        <div className="cards">
          {due.map((t) => (
            <TendCard key={t.id} tend={t} />
          ))}
        </div>
      )}

      {unlogged.length > 0 && (
        // Opened while searching, so a match in here isn't hidden.
        <details className="room-group" open={searching || undefined} key={searching ? 'searching' : 'browsing'}>
          <summary>
            <span>🥚 Not logged yet</span>
            <span className="muted small">{unlogged.length}</span>
          </summary>
          <p className="muted small">Nobody has ticked these off yet, so the habitat can’t tell how they’re doing. Doing one (or logging when it was last done) starts its schedule.</p>
          <div className="cards">
            {unlogged.map((t) => (
              <TendCard key={t.id} tend={t} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
