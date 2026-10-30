import { readSession, writeSession } from './local';
import type { PairingKind } from './api';

/*
 * Join links: a QR code or shared link opens /join#CODE (a device joining) or /join/user#CODE
 * (someone invited to sign in with their own email). The code is kept for this browser tab, so it
 * survives the trip to the email sign-in page and back, and the address bar goes back to "/".
 */

const KEY = 'eco.join';

export interface JoinLink {
  kind: PairingKind;
  code: string;
}

/** Call once at start-up, before anything else reads the address. */
export function captureJoinLink(): void {
  const { pathname, hash } = window.location;
  const kind: PairingKind | undefined = pathname === '/join' ? 'device' : pathname === '/join/user' ? 'user' : undefined;
  if (!kind) return;
  const code = decodeURIComponent(hash.replace(/^#/, '')).trim();
  if (code) writeSession(KEY, JSON.stringify({ kind, code } satisfies JoinLink));
  window.history.replaceState(null, '', '/');
}

/** The join link this tab was opened with, if it hasn't been used yet. */
export function pendingJoin(kind: PairingKind): string | undefined {
  try {
    const link = JSON.parse(readSession(KEY) ?? 'null') as JoinLink | null;
    return link?.kind === kind ? link.code : undefined;
  } catch {
    return undefined;
  }
}

export const clearJoin = () => writeSession(KEY, undefined);
