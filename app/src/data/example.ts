import { parseTendsCsv } from '../domain/csv';
import { importTends, resetEverything } from './actions';
import { CONNECTION_EVENT } from './api';
import { selectHabitatDb } from './db';
import { writeLocal, readLocal } from './local';

/** Loads the anonymised example household into the current habitat, with made-up recent history. */
export async function loadExample(): Promise<number> {
  const text = await (await fetch(`${import.meta.env.BASE_URL}sample-habitat.csv`)).text();
  const { tends, errors } = parseTendsCsv(text);
  if (errors.length) throw new Error(`The example file has problems: ${errors[0]}`);
  return importTends(tends, { replace: true, mockDates: true });
}

const DEMO_KEY = 'eco.demo';

/** The demo gets its own local database ("habitat-demo"), so it never mixes with a real habitat. */
export const DEMO_HABITAT_ID = 'demo';

/** True while someone is looking around the demo habitat on this device. */
export const isDemo = () => readLocal(DEMO_KEY) === 'on';

/** Opens a fresh demo habitat: no sign-in, no server, just the example household on this device. */
export async function startDemo(): Promise<void> {
  selectHabitatDb(DEMO_HABITAT_ID);
  await resetEverything();
  await loadExample();
  writeLocal('eco.member', undefined);
  writeLocal(DEMO_KEY, 'on');
  window.dispatchEvent(new Event(CONNECTION_EVENT));
}

/** Leaves the demo and throws its data away, so the next visit starts fresh. */
export async function leaveDemo(): Promise<void> {
  selectHabitatDb(DEMO_HABITAT_ID);
  await resetEverything();
  writeLocal('eco.member', undefined);
  writeLocal(DEMO_KEY, undefined);
  window.dispatchEvent(new Event(CONNECTION_EVENT));
}
