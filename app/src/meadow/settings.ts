import { useSyncExternalStore } from 'react';
import { readLocal, writeLocal } from '../data/local';

/** Whether this device shows the meadow. On unless someone here turned it off. */
const KEY = 'eco.meadow';
const listeners = new Set<() => void>();

const meadowShown = () => readLocal(KEY) !== 'off';

export function setMeadowShown(shown: boolean): void {
  writeLocal(KEY, shown ? undefined : 'off');
  listeners.forEach((l) => l());
}

export function useMeadowShown(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    meadowShown,
  );
}
