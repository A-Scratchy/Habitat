import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { completeTends, undoWins } from '../data/actions';
import { playSound, primeSound } from './sounds';
import { db } from '../data/db';
import { readLocal, writeLocal } from '../data/local';
import { DAY, startOfDay, startOfWeek } from '../domain/dates';
import type { ViewContext } from '../domain/selection';
import { byRoomOrder, type Member, type Tend, type Win, type Room } from '../domain/types';

export interface Habitat {
  /** In display order. */
  rooms: Room[];
  roomById: Map<string, Room>;
  /** A room's name; '' for none or an unknown id. Handy for search and labels. */
  roomName(id?: string): string;
  tends: Tend[];
  members: Member[];
  /** Wins since the start of this week (and at least since yesterday). */
  wins: Win[];
  me?: Member;
  ctx: ViewContext;
  memberById: Map<string, Member>;
  setMe(id: string | undefined): void;
  /** Defaults to "me, just now". */
  complete(tendIds: string[], opts?: { memberIds?: string[]; at?: number }): Promise<void>;
}

const HabitatContext = createContext<Habitat | null>(null);

export function useHabitat(): Habitat {
  const h = useContext(HabitatContext);
  if (!h) throw new Error('useHabitat outside provider');
  return h;
}

export { readLocal, writeLocal };

/** Current time, refreshed every minute and whenever the app comes back into view. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}

const CHEERS = ['Habitat nurtured! 🌿', 'Nicely tended! ✨', 'The ecosystem thanks you 🐝', 'Lovely work 🌸', 'Another leaf on the tree 🍃', 'Nicely done 🦔'];

interface Toast {
  message: string;
  winIds: string[];
}

export function HabitatProvider({ children, loading }: { children: (state: 'loading' | 'empty' | 'ready') => ReactNode; loading?: ReactNode }) {
  const now = useNow();
  const since = Math.min(startOfWeek(now), startOfDay(now) - DAY);
  const rooms = useLiveQuery(() => db.rooms.toArray(), []);
  const tends = useLiveQuery(() => db.tends.toArray(), []);
  const members = useLiveQuery(() => db.members.toArray(), []);
  const wins = useLiveQuery(() => db.wins.where('at').aboveOrEqual(since).toArray(), [since]);
  const [meId, setMeId] = useState(() => readLocal('eco.member'));
  const [toast, setToast] = useState<Toast>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const setMe = useCallback((id: string | undefined) => {
    setMeId(id);
    writeLocal('eco.member', id);
  }, []);

  const showToast = useCallback((t: Toast) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(undefined), 6000);
  }, []);

  const complete = useCallback(
    async (tendIds: string[], opts: { memberIds?: string[]; at?: number } = {}) => {
      const memberIds = opts.memberIds ?? (meId ? [meId] : []);
      if (!memberIds.length) return;
      // Ready the sound while this is still the tap: browsers won't start audio after the wait.
      primeSound();
      const winIds = await completeTends(tendIds, memberIds, opts.at);
      // The sound of whoever's using this device, once it's actually saved.
      const sound = members?.find((m) => m.id === meId)?.sound;
      if (sound) playSound(sound);
      const quest = tendIds.length === 1 && tends?.find((x) => x.id === tendIds[0])?.kind === 'quest';
      const message =
        quest
          ? 'Quest complete! 🏆 It’s on the Completed shelf.'
          : winIds.length > 1
          ? `${winIds.length} done in one sweep! 🚀`
          : memberIds.length > 1
            ? 'Logged: done together ✨'
            : CHEERS[Math.floor(Math.random() * CHEERS.length)];
      showToast({ message, winIds });
    },
    [meId, tends, members, showToast],
  );

  const value = useMemo<Habitat | null>(() => {
    if (!rooms || !tends || !members || !wins) return null;
    const memberById = new Map(members.map((m) => [m.id, m]));
    const roomById = new Map(rooms.map((r) => [r.id, r]));
    const me = meId ? memberById.get(meId) : undefined;
    return {
      rooms: [...rooms].sort(byRoomOrder),
      roomById,
      roomName: (id?: string) => (id ? (roomById.get(id)?.name ?? '') : ''),
      tends,
      members,
      wins,
      me,
      ctx: { now, memberId: me?.id },
      memberById,
      setMe,
      complete,
    };
  }, [rooms, tends, members, wins, meId, now, setMe, complete]);

  if (!value) return <>{loading}</>;
  const state = value.tends.length === 0 && value.members.length === 0 ? 'empty' : 'ready';
  return (
    <HabitatContext.Provider value={value}>
      {children(state)}
      <div className="toast-region" aria-live="polite">
        {toast && (
          <div className="toast">
            <span>{toast.message}</span>
            <button
              className="link"
              onClick={() => {
                void undoWins(toast.winIds);
                setToast(undefined);
              }}
            >
              Undo
            </button>
          </div>
        )}
      </div>
    </HabitatContext.Provider>
  );
}
