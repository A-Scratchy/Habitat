import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { signedInAccount, signIn, userToken } from '../auth/entra';
import { approveDevice, createPairingCode, listDevices, readConnection, revokeDevice, type HabitatDevice, type PairingCode, type PairingKind } from '../data/api';
import { ConfirmButton } from './Confirm';

/** How often the screen checks for new requests to join while it's open. */
const REFRESH_MS = 5_000;

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/** A code to show or share: big and easy to type, a QR code to scan, and a countdown so nobody uses a stale one. */
function ShareCode({ code, onDone }: { code: PairingCode; onDone(): void }) {
  const link = `${window.location.origin}${code.joinPath}`;
  const [qr, setQr] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const left = Math.max(0, Math.round((Date.parse(code.expiresAt) - now) / 1000));

  useEffect(() => {
    void QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setQr);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [link]);

  if (left === 0) {
    return (
      <div className="panel stack">
        <p className="muted small">That code has expired. Make a new one when you’re ready.</p>
        <button className="btn-soft" onClick={onDone}>
          OK
        </button>
      </div>
    );
  }

  return (
    <div className="panel stack share-code">
      <p className="small">{code.kind === 'device' ? 'On the new device, scan this or open the habitat and choose “Join with a code”.' : 'They scan this, or sign in on the habitat and choose “I have an invite”.'}</p>
      {qr && <img className="qr" src={qr} alt={`QR code for ${link}`} width={220} height={220} />}
      <p className="big-code" aria-label={`Code ${code.code.split('').join(' ')}`}>
        {code.code}
      </p>
      <p className="muted small">
        Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more.
      </p>
      <div className="actions">
        {'share' in navigator && (
          <button className="btn-soft" onClick={() => void navigator.share({ title: 'Join our habitat', url: link }).catch(() => undefined)}>
            Share link
          </button>
        )}
        <button className="link" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * Settings → Devices: add a device with a code, invite another user, approve or turn away
 * requests to join, and remove devices. All of it needs someone signed in with their email.
 */
export function DevicesAdmin() {
  const account = signedInAccount();
  const thisDevice = readConnection()?.deviceId;
  const [devices, setDevices] = useState<HabitatDevice[]>();
  const [code, setCode] = useState<PairingCode>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setDevices(await listDevices(await userToken()));
    } catch (e) {
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    if (!account) return;
    void refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && void refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [account, refresh]);

  /** Runs one action, showing it as busy and any problem underneath. */
  const act = async (key: string, run: (token: string) => Promise<unknown>) => {
    setBusy(key);
    setError(undefined);
    try {
      await run(await userToken());
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
    }
  };

  const makeCode = (kind: PairingKind) =>
    act(`code-${kind}`, async (token) => {
      setCode(await createPairingCode(token, kind));
    });

  if (!account) {
    return (
      <div className="stack">
        <p className="muted">Adding devices and approving people needs someone who signs in with their email. This device joined with a code.</p>
        <button className="btn-soft" onClick={() => void signIn()}>
          Sign in with email ✉️
        </button>
      </div>
    );
  }

  const waiting = devices?.filter((d) => d.status === 'pending') ?? [];
  const connected = devices?.filter((d) => d.status === 'approved') ?? [];

  return (
    <div className="stack">
      {error && <p className="panel error small">{error}</p>}

      {waiting.length > 0 && (
        <section className="stack">
          <h3 className="section-title">Waiting to join</h3>
          {waiting.map((d) => (
            <div key={d.id} className="panel stack">
              <p>
                {d.joiningAsUser ? (
                  <>
                    <strong>{d.joiningAsUser}</strong> wants to join with their email, on a {d.name.toLowerCase()}
                  </>
                ) : (
                  <>
                    A <strong>{d.name.toLowerCase()}</strong> wants to join
                  </>
                )}
                <span className="muted small"> · asked {ago(d.createdAt)}</span>
              </p>
              <div className="actions">
                <button className="btn-done" disabled={!!busy} onClick={() => void act(`approve-${d.id}`, (t) => approveDevice(t, d.id))}>
                  {busy === `approve-${d.id}` ? 'Letting them in…' : 'Let them in 🌿'}
                </button>
                <button className="link" disabled={!!busy} onClick={() => void act(`reject-${d.id}`, (t) => revokeDevice(t, d.id))}>
                  Not now
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {code ? (
        <ShareCode code={code} onDone={() => setCode(undefined)} />
      ) : (
        <section className="stack">
          <h3 className="section-title">Add someone</h3>
          <button className="btn-soft wide" disabled={!!busy} onClick={() => void makeCode('device')}>
            📱 Add a device with a code
          </button>
          <p className="muted small">For kids’ devices and shared tablets: no email needed. You’ll approve it here once it asks to join.</p>
          <button className="btn-soft wide" disabled={!!busy} onClick={() => void makeCode('user')}>
            ✉️ Invite someone with their own email
          </button>
          <p className="muted small">For someone who’ll help manage the habitat, like a partner. They sign in with their own email, then you approve them.</p>
        </section>
      )}

      <section className="stack">
        <h3 className="section-title">Devices in the habitat</h3>
        {!devices && <p className="muted small">Looking…</p>}
        <ul className="admin-list">
          {connected.map((d) => (
            <li key={d.id} className="completed-row">
              <span>
                {d.name}
                {d.id === thisDevice ? ' (this one)' : ''}
                <span className="muted small">
                  {' '}
                  · {d.signedInByUser ? 'signed in with email' : 'joined with a code'} · used {ago(d.lastSeenAt)}
                </span>
              </span>
              {d.id !== thisDevice && (
                <ConfirmButton
                  className="link danger"
                  question={`Remove this ${d.name.toLowerCase()} from the habitat? It will need a new code to come back.`}
                  confirmLabel="Yes, remove it"
                  onConfirm={() => act(`remove-${d.id}`, (t) => revokeDevice(t, d.id))}
                >
                  Remove
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
        <p className="muted small">To take this device out, sign out from your profile.</p>
      </section>
    </div>
  );
}
