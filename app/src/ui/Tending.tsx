import { useState } from 'react';
import { deleteTend, restartQuest, saveTend } from '../data/actions';
import { dayKey, parseDay } from '../domain/dates';
import { completedQuests, matchesQuery } from '../domain/selection';
import {
  DESCRIPTION_MAX,
  ENERGY,
  ENERGY_ORDER,
  KINDS,
  STATUSES,
  TIER_ORDER,
  TIERS,
  type EffortTier,
  type EnergyTag,
  type Tend,
  type TendKind,
  type TendStatus,
} from '../domain/types';
import { ConfirmButton } from './Confirm';
import { useHabitat } from './habitat';

/**
 * What the editor's inputs hold. Kind-specific fields are kept as typed text until Save, where
 * toTend() turns them into a proper Habit or Quest, or reports what's missing.
 */
interface Form {
  id?: string;
  kind: TendKind;
  name: string;
  room: string;
  group: string;
  description: string;
  tier: EffortTier;
  energy: EnergyTag[];
  status: TendStatus;
  ownerId: string;
  /** Habits only. Empty until someone types a number: a habit's schedule is never assumed. */
  frequency: string;
  lastDone: string;
  /** Quests only; kept as-is so editing a finished quest doesn't restart it. */
  completedAt?: number;
}

const blankForm = (kind: TendKind): Form => ({
  kind,
  name: '',
  room: '',
  group: '',
  description: '',
  tier: 'tortoise',
  energy: [],
  status: 'active',
  ownerId: '',
  frequency: '',
  lastDone: '',
});

const toForm = (t: Tend): Form => ({
  id: t.id,
  kind: t.kind,
  name: t.name,
  room: t.room,
  group: t.group ?? '',
  description: t.description ?? '',
  tier: t.tier,
  energy: t.energy,
  status: t.status,
  ownerId: t.ownerId ?? '',
  frequency: t.kind === 'habit' ? String(t.frequencyDays) : '',
  lastDone: t.lastDone != null ? dayKey(t.lastDone) : '',
  completedAt: t.kind === 'quest' ? t.completedAt : undefined,
});

/** Builds the typed tend from the form, or says what needs fixing. */
function toTend(f: Form): { tend: Parameters<typeof saveTend>[0] } | { errors: string[] } {
  const errors: string[] = [];
  if (!f.name.trim()) errors.push('Give it a name.');
  if (f.description.length > DESCRIPTION_MAX) errors.push(`Keep the description under ${DESCRIPTION_MAX} characters.`);
  const days = Number(f.frequency);
  if (f.kind === 'habit' && !(Number.isInteger(days) && days >= 1 && days <= 3650)) errors.push('A habit needs to say how often: every 1 to 3650 days.');
  if (errors.length) return { errors };

  const common = {
    id: f.id,
    name: f.name.trim(),
    room: f.room.trim() || 'General',
    ...(f.group.trim() && { group: f.group.trim() }),
    ...(f.description.trim() && { description: f.description.trim() }),
    tier: f.tier,
    energy: f.energy,
    status: f.status,
    ...(f.ownerId && { ownerId: f.ownerId }),
    ...(f.lastDone && { lastDone: parseDay(f.lastDone) }),
  };
  return {
    tend: f.kind === 'habit' ? { ...common, kind: 'habit', frequencyDays: days } : { ...common, kind: 'quest', ...(f.completedAt != null && { completedAt: f.completedAt }) },
  };
}

function TendEditor({ initial, onClose }: { initial: Form; onClose(): void }) {
  const { tends, members } = useHabitat();
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });
  const rooms = [...new Set(tends.map((x) => x.room))].sort();
  const groups = [...new Set(tends.map((x) => x.group).filter(Boolean))].sort();
  const noun = KINDS[f.kind].label.toLowerCase();

  return (
    <form
      className="panel stack editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = toTend(f);
        if ('errors' in result) return setErrors(result.errors);
        await saveTend(result.tend);
        onClose();
      }}
    >
      <h3>{f.id ? `Edit ${noun}` : `New ${noun}`}</h3>

      <fieldset className="field">
        <legend>Habit or quest?</legend>
        <div className="chips">
          {(Object.keys(KINDS) as TendKind[]).map((k) => (
            <button type="button" key={k} className={`chip${f.kind === k ? ' on' : ''}`} aria-pressed={f.kind === k} title={KINDS[k].hint} onClick={() => set({ kind: k })}>
              {KINDS[k].emoji} {KINDS[k].label}
            </button>
          ))}
        </div>
        <span className="muted small">{KINDS[f.kind].hint}.</span>
      </fieldset>

      <label className="field">
        <span>Name</span>
        <input value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
      </label>
      <div className="row">
        <label className="field">
          <span>Room</span>
          <input list="rooms" value={f.room} onChange={(e) => set({ room: e.target.value })} maxLength={40} />
        </label>
        <label className="field">
          <span>Group (for “do all”)</span>
          <input list="groups" value={f.group} onChange={(e) => set({ group: e.target.value })} placeholder="e.g. Empty Bins" maxLength={40} />
        </label>
      </div>
      <datalist id="rooms">{rooms.map((r) => <option key={r} value={r} />)}</datalist>
      <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>

      <label className="field">
        <span>Description or how-to (optional; one step per line)</span>
        <textarea
          value={f.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={4}
          maxLength={DESCRIPTION_MAX}
          placeholder={'e.g.\nTake the bag out of the bin\nTie it and put it in the outside bin\nPut a new bag in'}
        />
      </label>

      <fieldset className="field">
        <legend>Effort</legend>
        <div className="chips">
          {TIER_ORDER.map((tier) => (
            <button type="button" key={tier} className={`chip${f.tier === tier ? ' on' : ''}`} aria-pressed={f.tier === tier} onClick={() => set({ tier })} title={TIERS[tier].hint}>
              {TIERS[tier].emoji} {TIERS[tier].label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Energy type</legend>
        <div className="chips">
          {ENERGY_ORDER.map((e) => {
            const on = f.energy.includes(e);
            return (
              <button type="button" key={e} className={`chip${on ? ' on' : ''}`} aria-pressed={on} title={ENERGY[e].hint} onClick={() => set({ energy: on ? f.energy.filter((x) => x !== e) : [...f.energy, e] })}>
                {ENERGY[e].emoji} {ENERGY[e].label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Status</legend>
        <div className="chips">
          {(Object.keys(STATUSES) as TendStatus[]).map((s) => (
            <button type="button" key={s} className={`chip${f.status === s ? ' on' : ''}`} aria-pressed={f.status === s} onClick={() => set({ status: s })}>
              {STATUSES[s]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="row">
        {f.kind === 'habit' && (
          <label className="field">
            <span>Every … days</span>
            <input type="number" min={1} max={3650} value={f.frequency} placeholder="e.g. 7" onChange={(e) => set({ frequency: e.target.value })} />
          </label>
        )}
        <label className="field">
          <span>Last done</span>
          <input type="date" value={f.lastDone} onChange={(e) => set({ lastDone: e.target.value })} />
        </label>
      </div>

      <label className="field">
        <span>Permanent owner</span>
        <select value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.animal} {m.name}
            </option>
          ))}
        </select>
      </label>

      {errors.length > 0 && (
        <ul className="panel error small report">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="actions">
        <button className="btn-done">Save</button>
        <button type="button" className="btn-soft" onClick={onClose}>
          Cancel
        </button>
        {f.id && (
          <ConfirmButton
            className="link danger"
            question={`Remove “${f.name}”? Past wins stay in the log.`}
            confirmLabel="Yes, remove it"
            onConfirm={async () => {
              await deleteTend(f.id!);
              onClose();
            }}
          >
            Remove {noun}
          </ConfirmButton>
        )}
      </div>
    </form>
  );
}

type View = 'habit' | 'quest' | 'completed';

/** The master list of habits and quests, to add, change, pause, remove or restart. */
export function Tending() {
  const { tends } = useHabitat();
  const [view, setView] = useState<View>('habit');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [editing, setEditing] = useState<Form>();

  const completed = completedQuests(tends);
  const counts: Record<View, number> = {
    habit: tends.filter((t) => t.kind === 'habit').length,
    quest: tends.filter((t) => t.kind === 'quest' && t.completedAt == null).length,
    completed: completed.length,
  };
  const inView = view === 'completed' ? completed : tends.filter((t) => t.kind === view && (view === 'habit' || t.completedAt == null));
  const shown = inView
    .filter((t) => matchesQuery(t, query) && (!paused || t.status === 'paused'))
    .sort((a, b) => a.room.localeCompare(b.room) || a.name.localeCompare(b.name));

  const rowButton = (t: Tend, showRoom: boolean) => (
    <button className="admin-row" onClick={() => setEditing(toForm(t))}>
        <span>
          {TIERS[t.tier].emoji} {t.name}
          {t.description ? ' 📝' : ''}
        </span>
        <span className="muted small">
          {showRoom ? `${t.room} · ` : ''}
          {t.kind === 'habit' ? `every ${t.frequencyDays}d` : t.completedAt != null ? `done ${new Date(t.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'one-off'}
          {t.status === 'paused' ? ' · Paused' : ''}
        </span>
    </button>
  );
  const row = (t: Tend, showRoom: boolean) => <li key={t.id}>{rowButton(t, showRoom)}</li>;

  // Searching shows matches flat; otherwise rooms stay folded, so it's never a wall of 200 tends.
  const flat = query.trim() !== '' || paused || view === 'completed';
  const rooms = [...new Set(shown.map((t) => t.room))];
  const views: [View, string][] = [
    ['habit', `${KINDS.habit.emoji} Habits`],
    ['quest', `${KINDS.quest.emoji} Quests`],
    ['completed', '🏆 Completed'],
  ];

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>Tending</h2>
        <p className="muted">Everything that looks after the habitat: habits that come back, and one-off quests.</p>
      </header>

      {editing ? (
        <TendEditor initial={editing} onClose={() => setEditing(undefined)} />
      ) : (
        <>
          <div className="chips" role="tablist">
            {views.map(([v, label]) => (
              <button key={v} role="tab" aria-selected={view === v} className={`chip${view === v ? ' on' : ''}`} onClick={() => setView(v)}>
                {label} ({counts[v]})
              </button>
            ))}
          </div>

          {view !== 'completed' && (
            <button className="btn-done" onClick={() => setEditing(blankForm(view))}>
              ＋ Add a {KINDS[view].label.toLowerCase()}
            </button>
          )}
          <div className="row">
            <input className="search" type="search" placeholder="Find…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a habit or quest" />
            {view !== 'completed' && (
              <button className={`chip${paused ? ' on' : ''}`} aria-pressed={paused} style={{ flex: 'none' }} onClick={() => setPaused(!paused)}>
                ⏸ Paused only
              </button>
            )}
          </div>

          {inView.length === 0 ? (
            <p className="empty">
              {view === 'completed'
                ? 'No finished quests yet. They’ll appear here, like trophies 🏆'
                : `No ${KINDS[view].plural.toLowerCase()} yet. Add one above, or import a list in Settings → Import & export.`}
            </p>
          ) : shown.length === 0 ? (
            <p className="empty">Nothing matches that.</p>
          ) : flat ? (
            <ul className="admin-list">
              {shown.map((t) =>
                view === 'completed' ? (
                  <li key={t.id} className="completed-row">
                    {rowButton(t, true)}
                    <button className="btn-soft" onClick={() => void restartQuest(t.id)}>
                      Restart
                    </button>
                  </li>
                ) : (
                  row(t, true)
                ),
              )}
            </ul>
          ) : (
            <div className="stack">
              {rooms.map((room) => {
                const inRoom = shown.filter((t) => t.room === room);
                return (
                  <details key={room} className="room-group">
                    <summary>
                      <span>{room}</span>
                      <span className="muted small">{inRoom.length}</span>
                    </summary>
                    <ul className="admin-list">{inRoom.map((t) => row(t, false))}</ul>
                  </details>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
