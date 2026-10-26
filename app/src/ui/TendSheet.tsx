import { useEffect, useRef, useState } from 'react';
import { setFrequency, updateTend, type CommonTendFields } from '../data/actions';
import { DAY, dayKey, parseDay } from '../domain/dates';
import { IMPACT_ORDER, IMPACTS, KINDS, OUT_AND_ABOUT, STATUSES, TIER_ORDER, TIERS, type Tend, type TendStatus } from '../domain/types';
import { useHabitat } from './habitat';

type When = 'today' | 'yesterday' | 'twoDays' | 'pick';

const FREQUENCIES = [1, 2, 3, 7, 14, 30, 60, 90, 365];

function LogPanel({ tend, defaultWho, onClose }: { tend: Tend; defaultWho: string[]; onClose(): void }) {
  const { members, ctx, complete } = useHabitat();
  const [who, setWho] = useState(defaultWho);
  const [when, setWhen] = useState<When>('today');
  const [picked, setPicked] = useState(dayKey(ctx.now - 3 * DAY));

  const at = () => {
    const noonDaysAgo = (n: number) => parseDay(dayKey(ctx.now - n * DAY))!;
    if (when === 'today') return Date.now();
    if (when === 'yesterday') return noonDaysAgo(1);
    if (when === 'twoDays') return noonDaysAgo(2);
    return parseDay(picked) ?? Date.now();
  };

  const whenOptions: [When, string][] = [
    ['today', 'Today'],
    ['yesterday', 'Yesterday'],
    ['twoDays', '2 days ago'],
    ['pick', '📅 Earlier…'],
  ];

  return (
    <div className="stack">
      <fieldset className="field">
        <legend>Who did it? Tag everyone who helped</legend>
        <div className="chips wrap">
          {members.map((m) => {
            const on = who.includes(m.id);
            return (
              <button key={m.id} type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setWho(on ? who.filter((x) => x !== m.id) : [...who, m.id])}>
                {m.animal} {m.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>When?</legend>
        <div className="chips wrap">
          {whenOptions.map(([id, label]) => (
            <button key={id} type="button" className={`chip${when === id ? ' on' : ''}`} aria-pressed={when === id} onClick={() => setWhen(id)}>
              {label}
            </button>
          ))}
        </div>
        {when === 'pick' && <input type="date" value={picked} max={dayKey(ctx.now)} onChange={(e) => e.target.value && setPicked(e.target.value)} aria-label="Date done" />}
      </fieldset>

      <button
        className="btn-done wide"
        disabled={who.length === 0}
        onClick={async () => {
          await complete([tend.id], { memberIds: who, at: at() });
          onClose();
        }}
      >
        Log it ✨
      </button>
    </div>
  );
}

/** Quick tweaks to the master tend; saved as you tap. Everything else is in the Tending tab. */
function TweakPanel({ tend }: { tend: Tend }) {
  const save = (patch: Partial<CommonTendFields>) => void updateTend(tend.id, patch);
  return (
    <div className="stack">
      <fieldset className="field">
        <legend>Ecological impact</legend>
        <div className="chips wrap">
          {IMPACT_ORDER.map((impact) => (
            <button key={impact} type="button" className={`chip${tend.impact === impact ? ' on' : ''}`} aria-pressed={tend.impact === impact} title={IMPACTS[impact].hint} onClick={() => save({ impact })}>
              {IMPACTS[impact].emoji} {IMPACTS[impact].label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Effort</legend>
        <div className="chips wrap">
          {TIER_ORDER.map((tier) => (
            <button key={tier} type="button" className={`chip${tend.tier === tier ? ' on' : ''}`} aria-pressed={tend.tier === tier} onClick={() => save({ tier })}>
              {TIERS[tier].emoji} {TIERS[tier].label}
            </button>
          ))}
        </div>
      </fieldset>

      {tend.kind === 'habit' && (
      <fieldset className="field">
        <legend>How often? Every … days</legend>
        <div className="chips wrap">
          {FREQUENCIES.map((n) => (
            <button key={n} type="button" className={`chip${tend.frequencyDays === n ? ' on' : ''}`} aria-pressed={tend.frequencyDays === n} onClick={() => void setFrequency(tend.id, n)}>
              {n}
            </button>
          ))}
          <input
            className="chip-input"
            type="number"
            min={1}
            key={tend.frequencyDays}
            defaultValue={FREQUENCIES.includes(tend.frequencyDays) ? '' : tend.frequencyDays}
            placeholder="Other"
            aria-label="Other number of days"
            onBlur={(e) => +e.target.value >= 1 && void setFrequency(tend.id, Math.round(+e.target.value))}
          />
        </div>
      </fieldset>
      )}

      <fieldset className="field">
        <legend>Status</legend>
        <div className="chips wrap">
          {(Object.keys(STATUSES) as TendStatus[]).map((s) => (
            <button key={s} type="button" className={`chip${tend.status === s ? ' on' : ''}`} aria-pressed={tend.status === s} onClick={() => save({ status: s })}>
              {STATUSES[s]}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="muted small">Changes save straight away. Everything else, including switching between habit and quest, is in the Tending tab.</p>
    </div>
  );
}

export function TendSheet({ tend, defaultWho, onClose }: { tend: Tend; defaultWho: string[]; onClose(): void }) {
  const { tends, roomName } = useHabitat();
  const [view, setView] = useState<'log' | 'tweak'>('log');
  const sheet = useRef<HTMLDivElement>(null);
  // Re-read the tend so quick tweaks show immediately.
  const live = tends.find((t) => t.id === tend.id) ?? tend;

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <div>
            <h3 id="sheet-title">{live.name}</h3>
            <p className="muted small">
              {KINDS[live.kind].emoji} {KINDS[live.kind].label} · {live.roomId ? roomName(live.roomId) : OUT_AND_ABOUT.name} · {IMPACTS[live.impact].emoji} {IMPACTS[live.impact].label} impact
            </p>
          </div>
          <button className={`icon-btn${view === 'tweak' ? ' on' : ''}`} onClick={() => setView(view === 'log' ? 'tweak' : 'log')} aria-label={view === 'log' ? `Adjust this ${KINDS[live.kind].label.toLowerCase()}` : 'Back to logging'}>
            ⚙️
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {view === 'log' && live.description && <Description text={live.description} />}
        {view === 'log' ? <LogPanel tend={live} defaultWho={defaultWho} onClose={onClose} /> : <TweakPanel tend={live} />}
      </div>
    </div>
  );
}

/** Notes or instructions: several lines read as numbered steps, one line as a note. */
export function Description({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return (
    <div className="panel description">
      <p className="muted small">How to</p>
      {lines.length > 1 ? (
        <ol>
          {lines.map((l, i) => (
            <li key={i}>{l.replace(/^(\d+[.)]|[-*•])\s*/, '')}</li>
          ))}
        </ol>
      ) : (
        <p>{lines[0]}</p>
      )}
    </div>
  );
}
