import { useEffect, useState } from 'react';
import { entraConfigured, signedInAccount, signOut } from '../auth/entra';
import { forgetConnection, readConnection } from '../data/api';
import { ConfirmButton } from './Confirm';

/** How long before a waiting screen admits it's slow and offers ways out. */
const PATIENCE_MS = 6000;

/** Where this device stands, in one line, so nobody has to guess whether they're signed in. */
export function SignInStatus({ waitingForApproval = false }: { waitingForApproval?: boolean }) {
  if (!entraConfigured) return null;
  const account = signedInAccount();
  if (waitingForApproval) return <div className="status-line">🔑 Joined with a code · waiting for approval</div>;
  if (!account && readConnection()) {
    return (
      <div className="status-line">
        🔑 Joined with a code · nobody signed in
        <span aria-hidden> · </span>
        <ConfirmButton className="link" question="Disconnect this device from the habitat?" confirmLabel="Yes, disconnect" onConfirm={forgetConnection}>
          Disconnect
        </ConfirmButton>
      </div>
    );
  }
  if (!account) return <div className="status-line">🔒 You’re not signed in on this device</div>;
  return (
    <div className="status-line">
      ✅ Signed in as <strong>{account.username}</strong>
      <span aria-hidden> · </span>
      <button className="link" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

/**
 * A calm "one moment" screen. It never leaves anyone stuck: with an error, or after a few seconds,
 * it explains and offers Try again, plus Sign out / Disconnect so there's always a way out.
 */
export function BusyScreen({ message, error }: { message: string; error?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), PATIENCE_MS);
    return () => clearTimeout(t);
  }, []);
  const stuck = slow || !!error;

  return (
    <section className="screen narrow welcome" aria-busy={!stuck}>
      <div className="welcome-mark" aria-hidden>
        🌱
      </div>
      <p aria-live="polite">{error ?? message}</p>
      <SignInStatus />
      {stuck && (
        <div className="stack">
          {!error && <p className="muted small">This is taking longer than usual. The Habitat server might be waking up, or you might be offline.</p>}
          <button className="btn-done wide" onClick={() => window.location.reload()}>
            Try again
          </button>
          {entraConfigured && signedInAccount() && (
            <button className="btn-soft wide" onClick={() => void signOut()}>
              Sign out
            </button>
          )}
          {entraConfigured && !signedInAccount() && readConnection() && (
            <button className="btn-soft wide" onClick={forgetConnection}>
              Disconnect this device
            </button>
          )}
        </div>
      )}
    </section>
  );
}
