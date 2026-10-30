import { useEffect, useState } from 'react';
import { signedInAccount, signIn, silentUserToken } from '../auth/entra';
import {
  ApiError,
  createHousehold,
  deviceStatus,
  forgetConnection,
  joinAsUser,
  pairDevice,
  saveConnection,
  signInDevice,
  type Connection,
} from '../data/api';
import { startDemo } from '../data/example';
import { clearJoin, pendingJoin } from '../data/join';
import { ANIMALS } from '../domain/types';
import { BusyScreen, SignInStatus } from './Busy';
import { AnimalPicker } from './Members';

type Step =
  | { kind: 'start' }
  | { kind: 'checking' }
  | { kind: 'new' }
  | { kind: 'awaiting' }
  | { kind: 'code' }
  | { kind: 'waiting'; connection: Connection };

const POLL_MS = 4000;

/**
 * Shown until this device belongs to a habitat. Users sign in with their email (one-time code);
 * every other device, kids' tablets included, joins with a code a user gives them.
 */
export function SignIn({ pending, onConnected }: { pending?: Connection; onConnected(c: Connection): void }) {
  const [step, setStep] = useState<Step>(() =>
    pending
      ? { kind: 'waiting', connection: pending }
      : pendingJoin('device')
        ? { kind: 'code' }
        : signedInAccount()
          ? { kind: 'checking' }
          : { kind: 'start' },
  );
  const [error, setError] = useState<string>();
  const account = signedInAccount();

  const [demoLoading, setDemoLoading] = useState(false);
  const openDemo = async () => {
    setDemoLoading(true);
    try {
      await startDemo();
    } catch (e) {
      fail(e);
      setDemoLoading(false);
    }
  };

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');

  /** Pending connections wait for approval; approved ones open the app. */
  const connected = (c: Connection) => {
    clearJoin();
    saveConnection(c);
    if (c.status === 'pending') setStep({ kind: 'waiting', connection: c });
    else onConnected(c);
  };

  // Signed in but this device isn't connected yet: ask the server where this email belongs.
  useEffect(() => {
    if (step.kind !== 'checking') return;
    let cancelled = false;
    (async () => {
      const token = await silentUserToken();
      if (!token) return signIn();
      try {
        const c = await signInDevice(token);
        if (!cancelled) connected(c);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.type === 'no-habitat') setStep({ kind: 'new' });
        else if (e instanceof ApiError && e.type === 'awaiting-approval') setStep({ kind: 'awaiting' });
        else {
          fail(e);
          setStep({ kind: 'start' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind]);

  // Waiting for a user to approve this device.
  useEffect(() => {
    if (step.kind !== 'waiting') return;
    const timer = setInterval(async () => {
      try {
        const s = await deviceStatus(step.connection);
        if (s.status === 'approved') {
          clearInterval(timer);
          const c: Connection = { ...step.connection, status: 'approved', householdId: s.householdId, householdName: s.householdName };
          saveConnection(c);
          onConnected(c);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          clearInterval(timer);
          forgetConnection();
          setError('That request wasn’t approved in time. Ask for a new code and try again.');
          setStep({ kind: 'start' });
        }
        // Anything else (e.g. offline for a moment): keep waiting.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [step, onConnected]);

  if (step.kind === 'checking') return <BusyScreen message="Finding your habitat…" />;

  return (
    <section className="screen narrow welcome">
      <div className="welcome-mark" aria-hidden>
        🌿
      </div>
      <h1>Welcome to the Habitat</h1>
      <p className="muted">A calm place where the whole pack looks after home together.</p>

      <SignInStatus waitingForApproval={step.kind === 'waiting'} />
      {error && <p className="panel error small">{error}</p>}

      {step.kind === 'start' && pendingJoin('user') && !account && (
        <p className="panel small">🔑 You’ve been invited to a habitat. Sign in with your email to accept; the invite code is kept for you.</p>
      )}

      {step.kind === 'start' && (
        <div className="stack">
          {account ? (
            <button
              className="btn-done wide"
              onClick={() => {
                setError(undefined);
                setStep({ kind: 'checking' });
              }}
            >
              Continue as {account.name || account.username} 🌿
            </button>
          ) : (
            <>
              <button className="btn-done wide" onClick={() => void signIn()}>
                Sign in with email ✉️
              </button>
              <p className="muted small">No password: we email you a one-time code. New here? This is also how you start a habitat.</p>
            </>
          )}
          <button
            className="btn-soft wide"
            onClick={() => {
              setError(undefined);
              setStep({ kind: 'code' });
            }}
          >
            Join with a code 🔑
          </button>
          <p className="muted small">For kids’ devices and shared tablets. Someone in your habitat gives you the code.</p>
          <button className="link center" disabled={demoLoading} onClick={() => void openDemo()}>
            {demoLoading ? 'Planting the demo…' : '👀 Just looking? Explore a demo habitat'}
          </button>
        </div>
      )}


      {step.kind === 'code' && <DeviceCode onBack={() => setStep({ kind: 'start' })} onJoined={connected} onError={fail} />}

      {step.kind === 'new' && <NewHere onDone={connected} onError={fail} />}

      {step.kind === 'awaiting' && (
        <div className="stack">
          <p>You’ve asked to join a habitat. Someone there needs to approve you, then sign in again.</p>
          <button className="btn-soft wide" onClick={() => setStep({ kind: 'checking' })}>
            Check again
          </button>
        </div>
      )}

      {step.kind === 'waiting' && (
        <div className="stack">
          <p className="waiting" aria-live="polite">
            Waiting for someone in your habitat to approve this device… 🐢
          </p>
          <p className="muted small">They’ll see it on their phone under Settings → Devices. This page opens the app as soon as they tap Approve.</p>
          <button
            className="link"
            onClick={() => {
              forgetConnection();
              setStep({ kind: 'start' });
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

function DeviceCode({ onBack, onJoined, onError }: { onBack(): void; onJoined(c: Connection): void; onError(e: unknown): void }) {
  const [code, setCode] = useState(() => pendingJoin('device') ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          onJoined(await pairDevice(code));
        } catch (err) {
          onError(err);
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Your code</span>
        <input className="code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7QP-M3XD" autoCapitalize="characters" autoComplete="off" autoFocus />
      </label>
      <button className="btn-done wide" disabled={busy || code.replace(/[^a-z0-9]/gi, '').length < 8}>
        {busy ? 'Joining…' : 'Join'}
      </button>
      <button
        type="button"
        className="link"
        onClick={() => {
          clearJoin();
          onBack();
        }}
      >
        Back
      </button>
    </form>
  );
}

/** Signed in, but this email isn't part of a habitat yet: start one, or join one with an invite. */
function NewHere({ onDone, onError }: { onDone(c: Connection): void; onError(e: unknown): void }) {
  // An invite link opens this on "I have an invite", with its code filled in.
  const [mode, setMode] = useState<'start' | 'join'>(() => (pendingJoin('user') ? 'join' : 'start'));
  const [householdName, setHouseholdName] = useState('Our Habitat');
  const [code, setCode] = useState(() => pendingJoin('user') ?? '');
  const [name, setName] = useState(() => signedInAccount()?.name ?? '');
  const [animal, setAnimal] = useState(ANIMALS[0]);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const token = await silentUserToken();
          if (!token) return void (await signIn());
          const details = { memberName: name.trim(), animal };
          onDone(mode === 'start' ? await createHousehold(token, { ...details, householdName: householdName.trim() }) : await joinAsUser(token, { ...details, code }));
        } catch (err) {
          onError(err);
          setBusy(false);
        }
      }}
    >
      <div className="chips" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'start'} className={`chip${mode === 'start' ? ' on' : ''}`} onClick={() => setMode('start')}>
          🌱 Start a new habitat
        </button>
        <button type="button" role="tab" aria-selected={mode === 'join'} className={`chip${mode === 'join' ? ' on' : ''}`} onClick={() => setMode('join')}>
          🔑 I have an invite
        </button>
      </div>

      {mode === 'start' ? (
        <label className="field">
          <span>Name your habitat</span>
          <input value={householdName} onChange={(e) => setHouseholdName(e.target.value)} maxLength={80} required />
        </label>
      ) : (
        <label className="field">
          <span>Invite code</span>
          <input className="code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7QP-M3XD" autoCapitalize="characters" autoComplete="off" required />
        </label>
      )}

      <label className="field">
        <span>Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
      </label>
      <fieldset className="field">
        <legend>Your animal</legend>
        <AnimalPicker value={animal} onChange={setAnimal} />
      </fieldset>

      <button className="btn-done wide" disabled={busy || !name.trim()}>
        {busy ? 'One moment…' : mode === 'start' ? `Start the habitat ${animal}` : `Ask to join ${animal}`}
      </button>
    </form>
  );
}
