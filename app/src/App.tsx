import { useState } from 'react';
import { Browse } from './ui/Browse';
import { HabitatProvider, readLocal, useHabitat, writeLocal } from './ui/habitat';
import { WhoIsHere } from './ui/Members';
import { QuickChoice } from './ui/QuickChoice';
import { QuickWins } from './ui/QuickWins';
import { Settings } from './ui/Settings';
import { WateringHole } from './ui/WateringHole';
import { Welcome } from './ui/Welcome';

const TABS = [
  { id: 'wins', icon: '🌊', label: 'Wins' },
  { id: 'quick', icon: '🍃', label: 'Quick' },
  { id: 'sloth', icon: '🦥', label: 'Sloth mode' },
  { id: 'forage', icon: '🍄', label: 'Forage' },
] as const;

type TabId = (typeof TABS)[number]['id'] | 'settings';

function Main() {
  const { me, setMe } = useHabitat();
  const [tab, setTabState] = useState<TabId>(() => {
    const saved = readLocal('eco.tab');
    return saved === 'settings' || TABS.some((t) => t.id === saved) ? (saved as TabId) : 'wins';
  });
  const setTab = (t: TabId) => {
    setTabState(t);
    writeLocal('eco.tab', t);
    window.scrollTo({ top: 0 });
  };

  if (!me) return <WhoIsHere />;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">🌿 Our Habitat</span>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={() => setMe(undefined)} title={`${me.name} (switch)`} aria-label={`Signed in as ${me.name}. Switch.`}>
            {me.animal}
          </button>
          <button className={`icon-btn${tab === 'settings' ? ' on' : ''}`} onClick={() => setTab('settings')} aria-label="Settings">
            ⚙️
          </button>
        </div>
      </header>

      <main>
        {tab === 'wins' && <WateringHole />}
        {tab === 'quick' && <QuickChoice />}
        {tab === 'sloth' && <QuickWins />}
        {tab === 'forage' && <Browse />}
        {tab === 'settings' && <Settings />}
      </main>

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

export function App() {
  return <HabitatProvider loading={<p className="loading">🌱</p>}>{(state) => (state === 'empty' ? <Welcome /> : <Main />)}</HabitatProvider>;
}
