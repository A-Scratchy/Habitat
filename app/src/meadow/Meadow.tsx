import { useEffect, useRef, useState } from 'react';
import { useHabitat } from '../ui/habitat';
import { onCelebrate } from './events';
import { useActiveMembers } from './presence';
import { useMeadowShown } from './settings';
import './meadow.css';

/*
 * The meadow: a strip above the tab bar where the animals of everyone using the app right now potter
 * about together. Opening the app, your animal walks on; when someone else opens it on their device,
 * theirs walks on too, and wanders off a little while after they stop. Doing something makes the
 * whole pack hop. No names, no scores, and nobody looks sad when rooms are thirsty.
 * Movement is slow, stops entirely with the phone's "reduce motion" setting, and the meadow can be
 * switched off per device (Settings → Pack).
 * Everything lives in this folder; the rest of the app only mounts <Meadow />, shows <MeadowSetting />
 * and calls celebrate().
 */

/** Seconds an animal rests before wandering again. */
const REST = { min: 4, max: 14 };
/** Walking speed, as a share of the meadow's width per second: an amble. */
const PACE = 5;
/** Keep wandering animals off the very edges (percent of the width). */
const EDGE = 5;
/** Just past each side of the screen, where animals walk on from and off to. */
const OFF_LEFT = -8;
const OFF_RIGHT = 108;

interface Critter {
  x: number;
  facingRight: boolean;
  walking: boolean;
  /** Seconds the current walk takes. */
  stride: number;
  /** Bumped to replay the hop. */
  hops: number;
  /** Walking off because they've stopped using the app; removed once off screen. */
  leaving: boolean;
}

const between = (min: number, max: number) => min + Math.random() * (max - min);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const strideFor = (from: number, to: number) => Math.max(1.5, Math.abs(to - from) / PACE);

/** Sets a walk from where the critter is to `x`. */
const walkTo = (c: Critter, x: number): Critter => ({ ...c, x, stride: strideFor(c.x, x), walking: true, facingRight: x > c.x });

export function Meadow() {
  const shown = useMeadowShown();
  const { me, memberById } = useHabitat();
  const active = useActiveMembers(me?.id).filter((id) => memberById.has(id));
  const activeKey = active.join();
  const [critters, setCritters] = useState<Record<string, Critter>>({});
  // The same state, readable from timers. Changes go through commit() so the two never drift,
  // and timers are only ever started outside state updates (React may run those twice).
  const current = useRef<Record<string, Critter>>({});
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const commit = (next: Record<string, Critter>) => {
    current.current = next;
    setCritters(next);
  };

  /** Changes one critter; returning undefined removes it. */
  const update = (id: string, change: (c: Critter) => Critter | undefined) => {
    const c = current.current[id];
    if (!c) return;
    const next = { ...current.current };
    const changed = change(c);
    if (changed) next[id] = changed;
    else delete next[id];
    commit(next);
  };

  /** A timer that's cleared if the meadow goes away. */
  const later = (fn: () => void, seconds: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, seconds * 1000);
    timers.current.add(t);
  };

  /** Walks someone to `x`, then lets them rest (or, if leaving, takes them away). */
  const stroll = (id: string, x: number, leaving = false) => {
    update(id, (c) => ({ ...walkTo(c, x), leaving }));
    const stride = current.current[id]?.stride ?? 0;
    later(() => update(id, (c) => (c.leaving !== leaving || c.x !== x ? c : leaving ? undefined : { ...c, walking: false })), stride);
  };

  // Tell the layout to leave room for the meadow (see meadow.css).
  useEffect(() => {
    document.documentElement.toggleAttribute('data-meadow', shown);
    return () => document.documentElement.removeAttribute('data-meadow');
  }, [shown]);

  // Sit exactly on top of the tab bar, whatever its height on this phone (it includes the home-bar gap).
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('.tabbar');
    if (!shown || !bar) return;
    const fit = () => document.documentElement.style.setProperty('--meadow-bottom', `${bar.offsetHeight}px`);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(bar);
    return () => watch.disconnect();
  }, [shown]);

  useEffect(() => {
    const live = timers.current;
    return () => {
      live.forEach(clearTimeout);
      live.clear();
    };
  }, []);

  // Arrivals walk on from a side; people who've stopped walk off and are gone.
  useEffect(() => {
    if (!shown) return;
    const ids = activeKey ? activeKey.split(',') : [];
    const calm = reducedMotion();
    for (const id of ids) {
      const c = current.current[id];
      const spot = between(EDGE, 100 - EDGE);
      const waitingAtEdge = c && !c.leaving && !c.walking && (c.x === OFF_LEFT || c.x === OFF_RIGHT);
      if (waitingAtEdge) {
        // Placed at the edge but the walk on never started (the meadow was briefly remounted).
        later(() => stroll(id, spot), 0.05);
        continue;
      }
      if (c && !c.leaving) continue;
      if (c?.leaving) {
        // Came back before they were gone: turn round.
        stroll(id, spot);
      } else if (calm) {
        commit({ ...current.current, [id]: { x: spot, facingRight: false, walking: false, stride: 0, hops: 0, leaving: false } });
      } else {
        const fromLeft = Math.random() < 0.5;
        commit({ ...current.current, [id]: { x: fromLeft ? OFF_LEFT : OFF_RIGHT, facingRight: fromLeft, walking: false, stride: 0, hops: 0, leaving: false } });
        // A moment later, start the walk on, so the browser animates it from the edge.
        later(() => current.current[id] && !current.current[id].walking && stroll(id, spot), 0.05);
      }
    }
    for (const [id, c] of Object.entries(current.current)) {
      if (ids.includes(id) || c.leaving) continue;
      if (calm) update(id, () => undefined);
      else stroll(id, c.x < 50 ? OFF_LEFT : OFF_RIGHT, true);
    }
    // stroll, commit and update only use refs and setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, shown]);

  // Now and then, someone who's resting wanders somewhere else.
  useEffect(() => {
    if (!shown) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(() => {
        const resting = Object.entries(current.current).filter(([, c]) => !c.walking && !c.leaving);
        if (!document.hidden && !reducedMotion() && resting.length > 0) {
          const [who] = resting[Math.floor(Math.random() * resting.length)];
          stroll(who, between(EDGE, 100 - EDGE));
        }
        next();
      }, (between(REST.min, REST.max) * 1000) / Math.max(1, Object.keys(current.current).length));
    };
    next();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // Something got done: the whole pack hops, one after another.
  useEffect(
    () =>
      onCelebrate(() => {
        if (reducedMotion()) return;
        commit(Object.fromEntries(Object.entries(current.current).map(([id, c]) => [id, { ...c, hops: c.hops + 1 }])));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!shown) return null;

  return (
    <div className="meadow" aria-hidden="true">
      {Object.entries(critters).map(([id, c], i) => {
        const member = memberById.get(id);
        if (!member) return null;
        return (
          <span key={id} className="critter" style={{ left: `${c.x}%`, transitionDuration: `${c.walking ? c.stride : 0}s` }}>
            <span
              // Remounting replays the hop; the stagger makes it a ripple through the pack.
              key={c.hops}
              className={`critter-hop${c.hops ? ' hop' : ''}`}
              style={c.hops ? { animationDelay: `${i * 90}ms` } : undefined}
              onClick={() => update(id, (x) => ({ ...x, hops: x.hops + 1 }))}
            >
              <span className={`critter-body${c.walking ? ' walking' : ''}`}>
                <span className={`critter-face${c.facingRight ? ' right' : ''}`}>{member.animal}</span>
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
