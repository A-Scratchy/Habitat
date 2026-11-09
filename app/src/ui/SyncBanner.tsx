import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
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

/** Says so, gently, when the server can't be reached or a change didn't reach it. */
export function SyncBanner() {
  const { online, waiting, problem } = useSyncStatus();
  const queued = useLiveQuery(() => db.outbox.count(), []) ?? 0;
  if (online && !waiting && !problem) return null;
  const kept = queued === 1 ? '1 change is saved on this device' : queued ? `${queued} changes are saved on this device` : '';
  const message =
    problem ??
    (!online
      ? `📡 Can’t reach the habitat right now. ${kept ? `${kept} and will send` : 'Anything you change is saved on this device and sends'} once it’s back.`
      : kept
        ? `🌱 The habitat is slow to answer. ${kept} and will send on its own.`
        : null);
  if (!message) return null;
  return (
    <div className="demo-banner sync-banner" role="status">
      <span>{message}</span>
      <button className="btn-soft" onClick={() => (problem ? dismissProblem() : void syncNow())}>
        {problem ? 'OK' : 'Try now'}
      </button>
    </div>
  );
}
