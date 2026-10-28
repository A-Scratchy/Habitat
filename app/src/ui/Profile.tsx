import { useEffect, useRef, useState } from 'react';
import { entraConfigured, signedInAccount, signOut } from '../auth/entra';
import { readConnection } from '../data/api';
import { isDemo, leaveDemo } from '../data/example';
import { saveMember } from '../data/actions';
import { useHabitat } from './habitat';
import { ConfirmButton } from './Confirm';
import { AnimalPicker, SoundPicker } from './Members';

/** The header avatar's menu: who you are on this device, and your sign-in. */
export function ProfileSheet({ onClose, onOpenAccountSettings }: { onClose(): void; onOpenAccountSettings(): void }) {
  const { me, setMe } = useHabitat();
  const [name, setName] = useState(me?.name ?? '');
  const sheet = useRef<HTMLDivElement>(null);
  const account = signedInAccount();
  const connection = readConnection();

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!me) return null;
  const nameChanged = name.trim() !== '' && name.trim() !== me.name;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-labelledby="profile-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <span className="profile-animal" aria-hidden>
            {me.animal}
          </span>
          <div>
            <h3 id="profile-title">{me.name}</h3>
            <p className="muted small">{isDemo() ? 'In the demo habitat' : connection ? `In ${connection.householdName ?? 'your habitat'}` : 'On this device only'}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (nameChanged) await saveMember({ ...me, name: name.trim() });
          }}
        >
          <label className="field">
            <span>Your name</span>
            <div className="row">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
              {nameChanged && (
                <button className="btn-soft" style={{ flex: 'none' }}>
                  Save
                </button>
              )}
            </div>
          </label>
          <fieldset className="field">
            <legend>Your animal</legend>
            <AnimalPicker value={me.animal} onChange={(animal) => void saveMember({ ...me, animal })} />
          </fieldset>
          <fieldset className="field">
            <legend>Sound when you finish something</legend>
            <SoundPicker value={me.sound} onChange={(sound) => void saveMember({ ...me, sound })} />
          </fieldset>
        </form>

        <button
          className="btn-soft"
          onClick={() => {
            onClose();
            setMe(undefined);
          }}
        >
          🔄 Someone else is using this device
        </button>

        {isDemo() && (
          <div className="panel stack">
            <p className="small muted">You’re exploring the demo. Leave it to sign in and start your own habitat.</p>
            <button className="btn-soft" onClick={() => void leaveDemo()}>
              Leave demo
            </button>
          </div>
        )}

        {entraConfigured && !isDemo() && (
          <div className="panel stack">
            {account ? (
              <>
                <p className="small">
                  Signed in as <strong>{account.username}</strong>
                </p>
                <ConfirmButton
                  question="Sign out and disconnect this device from the habitat? Habits and quests already on it stay here."
                  confirmLabel="Yes, sign out"
                  onConfirm={signOut}
                >
                  🚪 Sign out
                </ConfirmButton>
              </>
            ) : (
              <>
                <p className="small muted">{connection ? 'This device joined with a code; nobody is signed in on it.' : 'Not signed in. Your habitat is only on this device.'}</p>
                <button
                  className="btn-soft"
                  onClick={() => {
                    onClose();
                    onOpenAccountSettings();
                  }}
                >
                  ☁️ Household account
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
