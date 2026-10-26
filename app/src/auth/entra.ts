import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo, type AuthenticationResult } from '@azure/msal-browser';
import { forgetConnection, readConnection, revokeDevice } from '../data/api';

const env = import.meta.env;
const authority: string = env.VITE_ENTRA_AUTHORITY ?? '';
const clientId: string = env.VITE_ENTRA_CLIENT_ID ?? '';
const apiScope: string = env.VITE_ENTRA_API_SCOPE ?? '';

/** Signing in is optional: without these settings the app runs local-only, as before. */
export const entraConfigured = !!(authority && clientId && apiScope);

let msal: PublicClientApplication | undefined;

/**
 * Sets up MSAL and finishes a sign-in redirect if we've just come back from one.
 * Must run before the app renders, so the response in the URL is consumed first.
 */
export async function initEntra(): Promise<AuthenticationResult | null> {
  if (!entraConfigured) return null;
  msal = new PublicClientApplication({
    auth: {
      clientId,
      authority,
      knownAuthorities: [new URL(authority).host],
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'localStorage' },
  });
  await msal.initialize();
  try {
    return await msal.handleRedirectPromise();
  } catch (e) {
    console.warn('Sign-in did not complete', e);
    return null;
  } finally {
    // Coming back from sign-out leaves ?state=… in the address; nothing reads it after this.
    const url = new URL(window.location.href);
    if (url.searchParams.has('state')) {
      url.searchParams.delete('state');
      window.history.replaceState(null, '', url);
    }
  }
}

export const signedInAccount = (): AccountInfo | undefined => msal?.getAllAccounts()[0];

/** Leaves the app for the Habitat sign-in page (email one-time code) and comes back. */
export async function signIn(): Promise<void> {
  await msal!.loginRedirect({ scopes: [apiScope] });
}

/**
 * Signs out and disconnects this device. While the sign-in is still valid it revokes this device's
 * token on the server, so a signed-out phone can't keep reading the habitat. Local chores stay.
 */
export async function signOut(): Promise<void> {
  const connection = readConnection();
  const token = await silentUserToken();
  if (connection && token) await revokeDevice(token, connection.deviceId).catch(() => undefined);
  forgetConnection();
  await msal!.logoutRedirect({ account: signedInAccount() });
}

/** A user token only if it can be had without leaving the page; otherwise undefined. */
export async function silentUserToken(): Promise<string | undefined> {
  const account = signedInAccount();
  if (!account) return undefined;
  try {
    return (await msal!.acquireTokenSilent({ scopes: [apiScope], account })).accessToken;
  } catch {
    return undefined;
  }
}

/**
 * An Entra access token for calls only users may make (pairing, approving, revoking).
 * Usually silent; if the session has lapsed it redirects to sign in and this never resolves.
 */
export async function userToken(): Promise<string> {
  const account = signedInAccount();
  if (!account) {
    await signIn();
    return new Promise(() => {});
  }
  try {
    return (await msal!.acquireTokenSilent({ scopes: [apiScope], account })).accessToken;
  } catch (e) {
    if (!(e instanceof InteractionRequiredAuthError)) throw e;
    await msal!.acquireTokenRedirect({ scopes: [apiScope], account });
    return new Promise(() => {});
  }
}
