import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { dismissProblem, syncNow, useSyncStatus } from '../data/remote';

/** How often a connected habitat checks for what the rest of the pack has done. */
const PULL_EVERY_MS = 30_000;

/**
 * Keeps a connected habitat's copy fresh: on open, every so often, and on coming back to the app
 * or back online. Returns true once this device has a copy to show (straight away if it already had one).
 */
export function useAutoSync(householdId: string | undefined): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if (!householdId) return;
    let live = true;
    void (async () => {
      if (await db.meta.get('cursor')) setReady(true);
      await syncNow();
      if (live && (await db.meta.get('cursor'))) setReady(true);
    })();
    const pull = () => document.visibilityState === 'visible' && void syncNow();
    const id = setInterval(pull, PULL_EVERY_MS);
    document.addEventListener('visibilitychange', pull);
    window.addEventListener('online', pull);
    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', pull);
      window.removeEventListener('online', pull);
    };
  }, [householdId]);

  return ready;
}

/** Says so, gently, when the server can't be reached or a change wasn't saved. */
export function SyncBanner() {
  const { online, problem } = useSyncStatus();
  if (online && !problem) return null;
  return (
    <div className="demo-banner sync-banner" role="status">
      <span>{problem ?? '📡 Can’t reach the habitat right now. You’re seeing what this device last saw; changes can’t be saved until it’s back.'}</span>
      <button className="btn-soft" onClick={() => (problem ? dismissProblem() : void syncNow())}>
        {problem ? 'OK' : 'Try again'}
      </button>
    </div>
  );
}
