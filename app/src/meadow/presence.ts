import { useEffect, useState } from 'react';
import { call, readConnection } from '../data/api';
import { isRemote } from '../data/remote';

/*
 * Who's around: while the app is open, this device tells the server who's using it every so often,
 * and hears back who's active on any device in the habitat. When the app is put away it says so,
 * so their animal wanders off straight away rather than after the server's timeout.
 * Presence is best-effort: a failed check-in is simply tried again next time, never shown as an error.
 */

/** How often to check in while the app is open. The server counts someone active for 90 seconds after. */
const CHECK_IN_MS = 30_000;

interface PresenceResponse {
  active: string[];
}

function report(memberId: string | undefined, leaving = false): Promise<string[] | undefined> {
  const c = readConnection();
  if (!c) return Promise.resolve(undefined);
  // keepalive lets "I'm off" still reach the server as the app closes.
  return call<PresenceResponse>('/api/presence', { method: 'PUT', body: { memberId: memberId ?? null }, bearer: c.deviceToken, keepalive: leaving })
    .then((r) => r.active)
    .catch(() => undefined);
}

/**
 * The members active right now. Always includes whoever is using this device; in the demo and in
 * local-only habitats (no server) that's all it can know.
 */
export function useActiveMembers(meId: string | undefined): string[] {
  const [others, setOthers] = useState<string[]>([]);

  useEffect(() => {
    if (!isRemote()) return setOthers([]);
    let live = true;
    const checkIn = async () => {
      if (document.visibilityState !== 'visible') return;
      const active = await report(meId);
      if (live && active) setOthers(active);
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? void checkIn() : void report(undefined, true));
    void checkIn();
    const id = setInterval(checkIn, CHECK_IN_MS);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [meId]);

  return meId && !others.includes(meId) ? [meId, ...others] : others;
}
