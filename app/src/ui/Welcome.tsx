import { useState } from 'react';
import { readConnection } from '../data/api';
import { importTends } from '../data/actions';
import { parseTendsCsv } from '../domain/csv';
import { SignInStatus } from './Busy';
import { NewMemberForm } from './Members';
import { useHabitat } from './habitat';

export async function loadExample(): Promise<number> {
  const text = await (await fetch(`${import.meta.env.BASE_URL}sample-habitat.csv`)).text();
  return importTends(parseTendsCsv(text).tends, { replace: true, mockDates: true });
}

/** First run of a habitat on this device: nobody and no habits or quests here yet. */
export function Welcome() {
  const { setMe } = useHabitat();
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string>();
  const habitatName = readConnection()?.householdName;

  return (
    <section className="screen narrow welcome">
      <div className="welcome-mark" aria-hidden>
        🌿
      </div>
      <h1>{habitatName ? `Welcome to ${habitatName}` : 'Welcome to the Habitat'}</h1>
      <SignInStatus />
      <p className="muted">
        {habitatName
          ? 'Your habitat is ready on this device. Add some habits and quests to get going; you can change them any time in the Tending tab.'
          : 'A calm place where the whole pack looks after home together. No one is assigned anything.'}
      </p>
      {error && <p className="panel error small">{error}</p>}

      {fresh ? (
        <>
          <p>Start with yourself. Add habits and quests in the Tending tab, and the rest of the pack in Settings.</p>
          <NewMemberForm onSaved={setMe} />
        </>
      ) : (
        <div className="stack">
          <label className={`btn-done wide file${busy ? ' disabled' : ''}`}>
            Import my habits and quests (CSV) 📄
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const { tends, errors } = parseTendsCsv(await file.text());
                if (errors.length) return setError(`Nothing was imported. ${errors.slice(0, 3).join(' ')}${errors.length > 3 ? ` (and ${errors.length - 3} more problems)` : ''}`);
                if (tends.length === 0) return setError('There are no habits or quests in that file.');
                setBusy(true);
                await importTends(tends, { replace: true, mockDates: false });
              }}
            />
          </label>
          <button
            className="btn-soft wide"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await loadExample();
            }}
          >
            {busy ? 'Planting…' : 'Try the example household 🏡'}
          </button>
          <p className="muted small">About 160 habits and 60 quests with pretend “last done” dates, so every screen has something to show.</p>
          <button className="btn-soft wide" disabled={busy} onClick={() => setFresh(true)}>
            Start with nothing yet
          </button>
        </div>
      )}
    </section>
  );
}
