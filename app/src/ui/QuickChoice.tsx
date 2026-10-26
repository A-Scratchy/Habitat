import { useState } from 'react';
import { myClaims, quickSet } from '../domain/selection';
import { useHabitat } from './habitat';
import { TaskCard } from './TaskCard';

export function QuickChoice() {
  const { tasks, ctx } = useHabitat();
  const [round, setRound] = useState(0);
  const claims = myClaims(tasks, ctx);
  const picks = quickSet(tasks, ctx, round).filter((t) => !claims.includes(t));

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
              <TaskCard key={t.id} task={t} />
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
              <TaskCard key={t.id} task={t} />
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
