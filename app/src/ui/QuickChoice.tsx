import { useState } from 'react';
import { myClaims, quickSet } from '../domain/selection';
import { useHabitat } from './habitat';
import { TendCard } from './TendCard';

export function QuickChoice() {
  const { tends, ctx } = useHabitat();
  const [round, setRound] = useState(0);
  const claims = myClaims(tends, ctx);
  const picks = quickSet(tends, ctx, round).filter((t) => !claims.includes(t));

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>Quick Choice</h2>
        <p className="muted">One of each size, from what the habitat needs most. Pick one, and then you’re free.</p>
      </header>

      {claims.length > 0 && (
        <>
          <h3 className="section-title">You said you’d do</h3>
          <div className="cards">
            {claims.map((t) => (
              <TendCard key={t.id} tend={t} />
            ))}
          </div>
        </>
      )}

      {picks.length === 0 ? (
        <p className="empty">Nothing needs doing right now. Everything’s flourishing 🌳</p>
      ) : (
        <>
          <div className="cards">
            {picks.map((t) => (
              <TendCard key={t.id} tend={t} />
            ))}
          </div>
          <button className="btn-soft wide" onClick={() => setRound(round + 1)}>
            Show me a different set 🔄
          </button>
        </>
      )}
    </section>
  );
}
