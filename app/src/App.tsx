import { useCallback, useEffect, useState } from 'react';
import { entraConfigured } from './auth/entra';
import { adoptServerMember } from './data/actions';
import { ApiError, CONNECTION_EVENT, forgetConnection, getMe, readConnection, saveConnection } from './data/api';
import { db, selectHabitatDb } from './data/db';
import { Browse } from './ui/Browse';
import { BusyScreen } from './ui/Busy';
import { Tending } from './ui/Tending';
import { HabitatProvider, useHabitat, writeLocal } from './ui/habitat';
import { WhoIsHere } from './ui/Members';
import { ProfileSheet } from './ui/Profile';
import { QuickChoice } from './ui/QuickChoice';
import { QuickWins } from './ui/QuickWins';
import { Settings, type SettingsTab } from './ui/Settings';
import { SignIn } from './ui/SignIn';
import { WateringHole } from './ui/WateringHole';
import { Welcome } from './ui/Welcome';

const TABS = [
  { id: 'wins', icon: '🌊', label: 'Wins' },
  { id: 'quick', icon: '🍃', label: 'Quick' },
  { id: 'sloth', icon: '🦥', label: 'Sloth' },
  { id: 'forage', icon: '🍄', label: 'Forage' },
  { id: 'quests', icon: '🗺️', label: 'Quests' },
  { id: 'tending', icon: '🌱', label: 'Tending' },
] as const;

type TabId = (typeof TABS)[number]['id'] | 'settings';

function Main() {
  const { me } = useHabitat();
  const [profileOpen, setProfileOpen] = useState(false);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>();
  // Always opens on the Watering Hole: the family sees what's been done before anything else.
  const [tab, setTabState] = useState<TabId>('wins');
  const setTab = (t: TabId) => {
    setTabState(t);
    window.scrollTo({ top: 0 });
  };

  if (!me) return <WhoIsHere />;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">🌿 Our Habitat</span>
        <div className="topbar-actions">
          <button className={`icon-btn${profileOpen ? ' on' : ''}`} onClick={() => setProfileOpen(true)} title={me.name} aria-label={`${me.name}: profile and sign-in`}>
            {me.animal}
          </button>
          <button
            className={`icon-btn${tab === 'settings' ? ' on' : ''}`}
            onClick={() => {
              setSettingsTab(undefined);
              setTab('settings');
            }}
            aria-label="Settings"
          >
            ⚙️
          </button>
        </div>
      </header>

      <main>
        {tab === 'wins' && <WateringHole />}
        {tab === 'quick' && <QuickChoice />}
        {tab === 'sloth' && <QuickWins />}
        {tab === 'forage' && <Browse key="habit" kind="habit" />}
        {tab === 'quests' && <Browse key="quest" kind="quest" />}
        {tab === 'tending' && <Tending />}
        {tab === 'settings' && <Settings key={settingsTab} initialTab={settingsTab} />}
      </main>

      {profileOpen && (
        <ProfileSheet
          onClose={closeProfile}
          onOpenAccountSettings={() => {
            setSettingsTab('account');
            setTab('settings');
          }}
        />
      )}

      <nav className="tabbar" aria-label="Screens">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <span className="tab-icon" aria-hidden>
              {t.icon}
            </span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Re-reads this device's connection whenever it changes (connect, disconnect, sign out). */
function useConnection() {
  const [connection, setConnection] = useState(readConnection);
  useEffect(() => {
    const update = () => setConnection(readConnection());
    window.addEventListener(CONNECTION_EVENT, update);
    return () => window.removeEventListener(CONNECTION_EVENT, update);
  }, []);
  return connection;
}

export function App() {
  const connection = useConnection();
  const [adopting, setAdopting] = useState(false);
  const [lookupError, setLookupError] = useState<string>();
  const missingHouseholdId = entraConfigured && connection?.status === 'approved' && !connection.householdId;

  // Connections saved by older builds don't record which habitat they're in; ask once.
  useEffect(() => {
    if (!missingHouseholdId || !connection) return;
    getMe(connection)
      .then((me) => saveConnection({ ...connection, householdId: me.household.id, householdName: me.household.name }))
      .catch((e) => {
        // The server no longer knows this device: back to the sign-in page. Anything else: say so.
        if (e instanceof ApiError && e.status === 401) forgetConnection();
        else setLookupError(e instanceof Error ? e.message : 'Couldn’t reach the Habitat server.');
      });
  }, [missingHouseholdId, connection]);

  // With sign-in configured, nothing opens until this device belongs to a habitat.
  if (entraConfigured && (!connection || connection.status === 'pending' || adopting)) {
    return (
      <SignIn
        pending={connection?.status === 'pending' ? connection : undefined}
        onConnected={async (c) => {
          setAdopting(true);
          selectHabitatDb(c.householdId);
          if (c.me) writeLocal('eco.member', await adoptServerMember(c.me));
          setAdopting(false);
        }}
      />
    );
  }
  if (missingHouseholdId) return <BusyScreen message="Finding your habitat…" error={lookupError} />;

  // Each habitat has its own local database; remount everything when it changes.
  selectHabitatDb(entraConfigured ? connection?.householdId : undefined);
  return (
    <HabitatProvider key={db.name} loading={<BusyScreen message="Opening your habitat…" />}>
      {(state) => (state === 'empty' ? <Welcome /> : <Main />)}
    </HabitatProvider>
  );
}
