import { useEffect, useRef, useState } from 'react';
import { useHabitat } from '../ui/habitat';
import { onCelebrate } from './events';
import { useActiveMembers } from './presence';
import { useMeadowShown } from './settings';
import './meadow.css';

/*
 * The meadow: the whole pack lives in a strip above the tab bar. Anyone not using the app right now
 * is curled up asleep in the den at one end; when they open it on any device, their animal wakes,
 * stretches and wanders out, and when they put it away it pads back to the den. When anything gets
 * done, everyone celebrates, sleepers included. Sleep only ever means "not on the app": it never
 * says anything about who has or hasn't helped.
 * Movement is slow, stops with the phone's "reduce motion" setting, and the meadow can be switched
 * off per device (Settings → Pack).
 * Everything lives in this folder; the rest of the app only mounts <Meadow />, shows <MeadowSetting />
 * and calls celebrate().
 */

/** Seconds between someone awake wandering somewhere new. */
const REST = { min: 4, max: 14 };
/** Walking speed, as a share of the meadow's width per second: an amble. */
const PACE = 5;
/** The den, at the left end (percent of the width). Each sleeper gets a spot in it, snug together; a big pack squeezes up. */
const DEN_START = 3;
const DEN_SPOT = 6;
const DEN_MAX = 32;
/** Awake animals keep this far from the right-hand edge. */
const FAR_EDGE = 95;

interface Critter {
  x: number;
  awake: boolean;
  facingRight: boolean;
  walking: boolean;
  /** Seconds the current walk takes. */
  stride: number;
  /** Bumped to replay the last move. */
  hops: number;
  /** A hop (waking, celebrating, a tap while awake), or a twitch (a tap while asleep: it stays asleep). */
  move: 'hop' | 'twitch';
}

const between = (min: number, max: number) => min + Math.random() * (max - min);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const strideFor = (from: number, to: number) => Math.max(1.2, Math.abs(to - from) / PACE);

const spotWidth = (n: number) => Math.min(DEN_SPOT, DEN_MAX / Math.max(1, n));
/** Where someone sleeps: their own spot in the den, in pack order. */
const denSpot = (i: number, n: number) => DEN_START + (i + 0.5) * spotWidth(n);
/** The den's width, for drawing it. */
const denWidth = (n: number) => DEN_START + Math.max(1, n) * spotWidth(n);

export function Meadow() {
  const shown = useMeadowShown();
  const { me, members } = useHabitat();
  const active = useActiveMembers(me?.id);
  const pack = members.map((m) => m.id);
  const packKey = pack.join();
  const awakeKey = pack.filter((id) => active.includes(id)).join();
  const denEnd = denWidth(pack.length);

  const [critters, setCritters] = useState<Record<string, Critter>>({});
  // The same state, readable from timers. Changes go through commit() so the two never drift, and
  // timers are only started outside state updates (React may run those twice).
  const current = useRef<Record<string, Critter>>({});
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const commit = (next: Record<string, Critter>) => {
    current.current = next;
    setCritters(next);
  };

  const update = (id: string, change: (c: Critter) => Critter) => {
    const c = current.current[id];
    if (c) commit({ ...current.current, [id]: change(c) });
  };

  /** A timer that's cleared if the meadow goes away. */
  const later = (fn: () => void, seconds: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, seconds * 1000);
    timers.current.add(t);
  };

  /** Walks someone to `x`, then lets them settle there. */
  const stroll = (id: string, x: number) => {
    const c = current.current[id];
    if (!c) return;
    const stride = strideFor(c.x, x);
    update(id, () => ({ ...c, x, stride, walking: true, facingRight: x > c.x }));
    later(() => update(id, (now) => (now.x === x ? { ...now, walking: false } : now)), stride);
  };

  const wanderSpot = () => between(denEnd + 6, FAR_EDGE);

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

  // Everyone has a place: awake ones out in the meadow, sleepers in their den spot.
  // When someone wakes they stretch and wander out; when they stop, they pad back to the den.
  useEffect(() => {
    if (!shown) return;
    const ids = packKey ? packKey.split(',') : [];
    const awake = new Set(awakeKey ? awakeKey.split(',') : []);
    const next: Record<string, Critter> = {};
    const wakers: string[] = [];
    const sleepers: [string, number][] = [];
    ids.forEach((id, i) => {
      const c = current.current[id];
      const isAwake = awake.has(id);
      if (!c) {
        // New to the meadow: start in the den (wakers stroll out from there).
        next[id] = { x: denSpot(i, ids.length), awake: false, facingRight: true, walking: false, stride: 0, hops: 0, move: 'hop' };
        if (isAwake) wakers.push(id);
      } else {
        next[id] = c;
        if (isAwake && !c.awake) wakers.push(id);
        // Awake but still sitting in the den (its walk out was cut short): head out now.
        if (isAwake && c.awake && !c.walking && c.x < denWidth(ids.length)) later(() => stroll(id, wanderSpot()), 0.7);
        // Going to sleep, or the pack changed and their den spot moved.
        if (!isAwake && (c.awake || (!c.walking && c.x !== denSpot(i, ids.length)))) sleepers.push([id, denSpot(i, ids.length)]);
      }
    });
    commit(next);
    for (const id of wakers) {
      // A stretch (hop) first, then out into the meadow.
      update(id, (c) => ({ ...c, awake: true, hops: c.hops + 1, move: 'hop' }));
      later(() => current.current[id]?.awake && stroll(id, wanderSpot()), 0.7);
    }
    for (const [id, spot] of sleepers) {
      update(id, (c) => ({ ...c, awake: false }));
      stroll(id, spot);
    }
    // stroll, commit, update and later only use refs and setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packKey, awakeKey, shown]);

  // Now and then, someone awake and resting wanders somewhere else.
  useEffect(() => {
    if (!shown) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      const awake = Object.entries(current.current).filter(([, c]) => c.awake && !c.walking);
      t = setTimeout(
        () => {
          if (!document.hidden && !reducedMotion() && awake.length > 0) stroll(awake[Math.floor(Math.random() * awake.length)][0], wanderSpot());
          next();
        },
        (between(REST.min, REST.max) * 1000) / Math.max(1, awake.length),
      );
    };
    next();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, denEnd]);

  // Something got done: everyone celebrates, one after another, sleepers too.
  useEffect(
    () =>
      onCelebrate(() => {
        if (reducedMotion()) return;
        commit(Object.fromEntries(Object.entries(current.current).map(([id, c]) => [id, { ...c, hops: c.hops + 1, move: 'hop' as const }])));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!shown || members.length === 0) return null;

  return (
    <div className="meadow" aria-hidden="true">
      <span className="meadow-den" style={{ width: `${denEnd + 2}%` }} />
      {members.map((m, i) => {
        const c = critters[m.id];
        if (!c) return null;
        const sleeping = !c.awake && !c.walking;
        return (
          <span key={m.id} className="critter" style={{ left: `${c.x}%`, transitionDuration: `${c.walking ? c.stride : 0}s` }}>
            <span
              // Remounting replays the hop or twitch; the stagger makes a celebration ripple through the pack.
              key={c.hops}
              className={`critter-hop${c.hops ? ` ${c.move}` : ''}`}
              style={c.hops ? { animationDelay: `${i * 90}ms` } : undefined}
              // Tapping an awake animal makes it hop; a sleeper just twitches and stays asleep.
              onClick={() => update(m.id, (x) => ({ ...x, hops: x.hops + 1, move: !x.awake && !x.walking ? 'twitch' : 'hop' }))}
            >
              <span className={`critter-body${c.walking ? ' walking' : ''}${sleeping ? ' asleep' : ''}`}>
                <span className={`critter-face${c.facingRight ? ' right' : ''}`}>{m.animal}</span>
                {sleeping && <span className="zz">💤</span>}
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
