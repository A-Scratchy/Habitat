import { readLocal, writeLocal } from './local';

const base: string = import.meta.env.VITE_API_URL ?? '';

export interface HouseholdInfo {
  id: string;
  name: string;
  timeZoneId: string;
}

export interface ServerMember {
  id: string;
  name: string;
  animal: string;
  /** Signs in with an email and can manage the habitat. */
  isUser: boolean;
}

type DeviceStatus = 'approved' | 'pending';

interface SessionResponse {
  deviceToken: string;
  deviceId: string;
  status: DeviceStatus;
  household: HouseholdInfo;
  memberId: string;
}

interface PairResponse {
  deviceToken: string;
  deviceId: string;
  status: DeviceStatus;
}

export interface MeResponse {
  deviceId: string;
  household: HouseholdInfo;
  members: ServerMember[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Problem "type" the API uses for cases the app handles, e.g. "no-habitat". */
    readonly type?: string,
  ) {
    super(message);
  }
}

export async function call<T>(path: string, init: { method?: string; body?: unknown; bearer?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(init.bearer && { Authorization: `Bearer ${init.bearer}` }),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the Habitat server. Check your connection and try again.');
  }
  if (!res.ok) {
    const problem = await res.json().catch(() => undefined);
    throw new ApiError(res.status, problem?.detail ?? problem?.title ?? `Request failed (${res.status})`, problem?.type);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/**
 * This device's place in a habitat. A device joined with a code is "pending" until a user approves it.
 * memberId/name/animal are set when a user signed in, so the app knows who they are straight away.
 */
export interface Connection {
  deviceToken: string;
  deviceId: string;
  status: DeviceStatus;
  /** Known once approved. Each habitat gets its own local database, named after this. */
  householdId?: string;
  householdName?: string;
  me?: { memberId: string; name: string; animal: string };
}

const CONNECTION_KEY = 'eco.connection';

export function readConnection(): Connection | undefined {
  try {
    const raw = readLocal(CONNECTION_KEY);
    const c = raw ? (JSON.parse(raw) as Connection & { household?: HouseholdInfo }) : undefined;
    // Connections saved before "status" existed came from a user signing in, so they're approved.
    return c && { ...c, status: c.status ?? 'approved', householdId: c.householdId ?? c.household?.id, householdName: c.householdName ?? c.household?.name };
  } catch {
    return undefined;
  }
}

/** Fired on window whenever this device connects or disconnects, so the app can show or leave the sign-in page. */
export const CONNECTION_EVENT = 'habitat:connection';

export function saveConnection(c: Connection): void {
  writeLocal(CONNECTION_KEY, JSON.stringify(c));
  window.dispatchEvent(new Event(CONNECTION_EVENT));
}

/** Forgets the device token here. The device stays listed on the server until a user revokes it. */
export function forgetConnection(): void {
  writeLocal(CONNECTION_KEY, undefined);
  window.dispatchEvent(new Event(CONNECTION_EVENT));
}

export const guessDeviceName = () =>
  /iPad|Tablet/i.test(navigator.userAgent) ? 'Tablet' : /Android|iPhone/i.test(navigator.userAgent) ? 'Phone' : 'Computer';

const fromSession = (s: SessionResponse, me?: { name: string; animal: string }): Connection => ({
  deviceToken: s.deviceToken,
  deviceId: s.deviceId,
  status: s.status,
  householdId: s.household.id,
  householdName: s.household.name,
  me: me && { memberId: s.memberId, ...me },
});

/** A signed-in user's device joins their existing habitat. Throws "no-habitat" or "awaiting-approval" problems otherwise. */
export async function signInDevice(userToken: string): Promise<Connection> {
  return fromSession(await call<SessionResponse>('/api/auth/sign-in', { method: 'POST', bearer: userToken, body: { deviceName: guessDeviceName() } }));
}

export async function createHousehold(userToken: string, d: { householdName: string; memberName: string; animal: string }): Promise<Connection> {
  const s = await call<SessionResponse>('/api/households', {
    method: 'POST',
    bearer: userToken,
    body: { ...d, deviceName: guessDeviceName(), timeZoneId: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
  return fromSession(s, { name: d.memberName, animal: d.animal });
}

/** Joins someone else's habitat as a user with an invite code. Pending until one of its users approves. */
export async function joinAsUser(userToken: string, d: { code: string; memberName: string; animal: string }): Promise<Connection> {
  const s = await call<SessionResponse>('/api/auth/join', { method: 'POST', bearer: userToken, body: { ...d, deviceName: guessDeviceName() } });
  return fromSession(s, { name: d.memberName, animal: d.animal });
}

/** Any device (no email needed) joins with a device code. Pending until a user approves it. */
export async function pairDevice(code: string): Promise<Connection> {
  const p = await call<PairResponse>('/api/devices/pair', { method: 'POST', body: { code, deviceName: guessDeviceName() } });
  return { deviceToken: p.deviceToken, deviceId: p.deviceId, status: p.status };
}

/** Whether a pending device has been approved yet. A 401 means it was rejected or took too long. */
export const deviceStatus = (c: Connection) =>
  call<{ deviceId: string; status: DeviceStatus; householdId: string; householdName: string }>('/api/devices/self', { bearer: c.deviceToken });

/** Revokes a device on the server. Needs a user's Entra token, not a device token. */
export const revokeDevice = (userToken: string, deviceId: string) =>
  call<void>(`/api/devices/${deviceId}`, { method: 'DELETE', bearer: userToken });

export const getMe = (c: Connection) => call<MeResponse>('/api/me', { bearer: c.deviceToken });
