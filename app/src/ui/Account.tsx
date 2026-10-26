import { useState } from 'react';
import { entraConfigured, signedInAccount, signIn } from '../auth/entra';
import { forgetConnection, getMe, readConnection, type MeResponse } from '../data/api';
import { isDemo } from '../data/example';
import { ConfirmButton } from './Confirm';

/** This device's place in the habitat. Habits and quests still live only on this device until sync lands. */
export function AccountAdmin() {
  const [connection] = useState(readConnection);
  const account = signedInAccount();
  const [check, setCheck] = useState<{ ok: true; me: MeResponse } | { ok: false; error: string }>();
  const [busy, setBusy] = useState(false);

  if (isDemo()) {
    return <p className="muted">This is the demo habitat. It stays on this device; leave the demo to sign in and start your own.</p>;
  }

  if (!entraConfigured || !connection) {
    return <p className="muted">This build runs on this device only.</p>;
  }

  return (
    <div className="stack">
      <div className="panel stack">
        <p>
          In <strong>{connection.householdName ?? 'your habitat'}</strong> 🌿
        </p>
        <p className="muted small">{account ? `Signed in as ${account.username}` : 'This device joined with a code; nobody is signed in on it.'}</p>
        <p className="muted small">Sharing habits, quests and wins between devices comes next. For now they still live on this device.</p>
      </div>
      {!account && (
        <button className="btn-soft" onClick={() => void signIn()}>
          Sign in with email to manage the habitat
        </button>
      )}
      <button
        className="btn-soft"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setCheck({ ok: true, me: await getMe(connection) });
          } catch (e) {
            setCheck({ ok: false, error: e instanceof Error ? e.message : 'Could not reach the server.' });
          } finally {
            setBusy(false);
          }
        }}
      >
        Check the connection
      </button>
      {check?.ok && (
        <p className="muted small">
          The server knows {check.me.members.length} {check.me.members.length === 1 ? 'member' : 'members'}:{' '}
          {check.me.members.map((m) => `${m.animal} ${m.name}`).join(', ')}
        </p>
      )}
      {check && !check.ok && <p className="small error-text">{check.error}</p>}
      <ConfirmButton
        className="link danger"
        question="Disconnect this device from the habitat? You’ll need to sign in or use a new code to come back."
        confirmLabel="Yes, disconnect"
        onConfirm={forgetConnection}
      >
        Disconnect this device
      </ConfirmButton>
    </div>
  );
}
