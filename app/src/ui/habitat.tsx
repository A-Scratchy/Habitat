import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { completeTasks, undoWins } from '../data/actions';
import { db } from '../data/db';
import { DAY, startOfDay, startOfWeek } from '../domain/dates';
import type { ViewContext } from '../domain/selection';
import type { Member, Task, Win } from '../domain/types';

export interface Habitat {
  tasks: Task[];
  members: Member[];
  /** Wins since the start of this week (and at least since yesterday). */
  wins: Win[];
  me?: Member;
  ctx: ViewContext;
  memberById: Map<string, Member>;
  setMe(id: string | undefined): void;
  /** Defaults to "me, just now". */
  complete(taskIds: string[], opts?: { memberIds?: string[]; at?: number }): Promise<void>;
}

const HabitatContext = createContext<Habitat | null>(null);

export function useHabitat(): Habitat {
  const h = useContext(HabitatContext);
  if (!h) throw new Error('useHabitat outside provider');
  return h;
}

export function readLocal(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeLocal(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the setting just won't be remembered.
  }
}

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

const CHEERS = ['Habitat nurtured! 🌿', 'Task smashed! ✨', 'The ecosystem thanks you 🐝', 'Lovely work 🌸', 'Another leaf on the tree 🍃', 'Nicely done 🦔'];

interface Toast {
  message: string;
  winIds: string[];
}

export function HabitatProvider({ children, loading }: { children: (state: 'loading' | 'empty' | 'ready') => ReactNode; loading?: ReactNode }) {
  const now = useNow();
  const since = Math.min(startOfWeek(now), startOfDay(now) - DAY);
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
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
    async (taskIds: string[], opts: { memberIds?: string[]; at?: number } = {}) => {
      const memberIds = opts.memberIds ?? (meId ? [meId] : []);
      if (!memberIds.length) return;
      const winIds = await completeTasks(taskIds, memberIds, opts.at);
      const others = memberIds.filter((id) => id !== meId).map((id) => members?.find((m) => m.id === id)?.name);
      const message =
        winIds.length > 1
          ? `${winIds.length} done in one sweep! 🚀`
          : others.length
            ? `Logged, thank you ${others.join(' & ')} ✨`
            : CHEERS[Math.floor(Math.random() * CHEERS.length)];
      showToast({ message, winIds });
    },
    [meId, members, showToast],
  );

  const value = useMemo<Habitat | null>(() => {
    if (!tasks || !members || !wins) return null;
    const memberById = new Map(members.map((m) => [m.id, m]));
    const me = meId ? memberById.get(meId) : undefined;
    return { tasks, members, wins, me, ctx: { now, memberId: me?.id }, memberById, setMe, complete };
  }, [tasks, members, wins, meId, now, setMe, complete]);

  if (!value) return <>{loading}</>;
  const state = value.tasks.length === 0 && value.members.length === 0 ? 'empty' : 'ready';
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
