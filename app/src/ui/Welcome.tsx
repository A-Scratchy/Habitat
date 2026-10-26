import { useState } from 'react';
import { importTasks } from '../data/actions';
import { parseChoresCsv } from '../domain/csv';
import { NewMemberForm } from './Members';
import { useHabitat } from './habitat';

export async function loadExample(): Promise<number> {
  const text = await (await fetch(`${import.meta.env.BASE_URL}sample-chores.csv`)).text();
  return importTasks(parseChoresCsv(text).tasks, { replace: true, mockDates: true });
}

export function Welcome() {
  const { setMe } = useHabitat();
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);

  return (
    <section className="screen narrow welcome">
      <div className="welcome-mark" aria-hidden>
        🌿
      </div>
      <h1>Welcome to the Habitat</h1>
      <p className="muted">A calm place where the whole pack looks after home together. No one is assigned anything.</p>

      {fresh ? (
        <>
          <p>Start with yourself. You can add tasks and the rest of the pack in Settings.</p>
          <NewMemberForm onSaved={setMe} />
        </>
      ) : (
        <div className="stack">
          <button
            className="btn-done wide"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await loadExample();
            }}
          >
            {busy ? 'Planting…' : 'Load our example household 🏡'}
          </button>
          <p className="muted small">About 220 chores with pretend “last done” dates, so every screen has something to show.</p>
          <button className="btn-soft wide" onClick={() => setFresh(true)}>
            Start empty
          </button>
        </div>
      )}
    </section>
  );
}
