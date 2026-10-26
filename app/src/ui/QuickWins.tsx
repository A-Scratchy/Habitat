import { useEffect, useState } from 'react';
import { momentum, pickRandom, quickWinsPool } from '../domain/selection';
import { useHabitat } from './habitat';
import { TaskCard } from './TaskCard';

const LEAVES = 6;

function Momentum({ count }: { count: number }) {
  const lit = Math.min(count, LEAVES);
  const text =
    count === 0
      ? 'Every leaf counts. One tiny thing is enough.'
      : count < 3
        ? `${count} small ${count === 1 ? 'win' : 'wins'} in the last couple of hours 🌱`
        : `${count} wins in the last couple of hours. You’re on a roll! 🌟`;
  return (
    <div className="panel momentum">
      <div className="leaves" aria-hidden>
        {Array.from({ length: LEAVES }, (_, i) => (
          <span key={i} className={i < lit ? 'leaf lit' : 'leaf'}>
            🍃
          </span>
        ))}
      </div>
      <p className="small">{text}</p>
    </div>
  );
}

export function QuickWins() {
  const { tasks, wins, ctx } = useHabitat();
  const pool = quickWinsPool(tasks, ctx);
  const [pickId, setPickId] = useState<string>();
  const current = pool.find((t) => t.id === pickId);

  useEffect(() => {
    if (!current && pool.length) setPickId(pickRandom(pool)?.id);
  }, [current, pool]);

  const shown = current ?? pool[0];

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>Sloth &amp; Tortoise Mode</h2>
        <p className="muted">Nothing here will drain your battery. Just one small thing.</p>
      </header>

      <Momentum count={momentum(wins, ctx.now)} />

      {shown ? (
        <>
          <TaskCard key={shown.id} task={shown} big />
          {pool.length > 1 && (
            <button className="btn-soft wide" onClick={() => setPickId(pickRandom(pool, shown.id)?.id)}>
              Show a different one 🔄
            </button>
          )}
        </>
      ) : (
        <p className="empty">No little jobs waiting. Have a rest, you’ve earned it 🦥</p>
      )}
    </section>
  );
}
