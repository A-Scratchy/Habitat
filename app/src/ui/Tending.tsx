import { useState } from 'react';
import { deleteRoom, deleteTend, moveRoom, restartQuest, saveRoom, saveTend } from '../data/actions';
import { dayKey, parseDay } from '../domain/dates';
import { completedQuests, matchesQuery, NO_ROOM } from '../domain/selection';
import {
  DESCRIPTION_MAX,
  ENERGY,
  ENERGY_ORDER,
  IMPACT_ORDER,
  IMPACTS,
  KINDS,
  OUT_AND_ABOUT,
  roomIcon,
  STATUSES,
  TIER_ORDER,
  TIERS,
  type EcologicalImpact,
  type EffortTier,
  type EnergyTag,
  type Room,
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
  /** Empty until chosen: a tend's room is never assumed. NO_ROOM is a quest's explicit "no room". */
  roomId: string;
  group: string;
  description: string;
  /** Empty until chosen, like the room. */
  impact: EcologicalImpact | '';
  tier: EffortTier;
  energy: EnergyTag[];
  status: TendStatus;
  /** Habits only: permanent owner, or '' for anyone. */
  ownerId: string;
  /** Quests only. Empty until chosen: who can take it on is never assumed. */
  availableTo: 'everyone' | string[] | '';
  /** Habits only. Empty until someone types a number: a habit's schedule is never assumed. */
  frequency: string;
  lastDone: string;
  /** Quests only; kept as-is so editing a finished quest doesn't restart it. */
  completedAt?: number;
}

const blankForm = (kind: TendKind): Form => ({
  kind,
  name: '',
  roomId: '',
  group: '',
  description: '',
  impact: '',
  tier: 'tortoise',
  energy: [],
  status: 'active',
  ownerId: '',
  availableTo: '',
  frequency: '',
  lastDone: '',
});

const toForm = (t: Tend): Form => ({
  id: t.id,
  kind: t.kind,
  name: t.name,
  roomId: t.roomId ?? NO_ROOM,
  group: t.group ?? '',
  description: t.description ?? '',
  impact: t.impact,
  tier: t.tier,
  energy: t.energy,
  status: t.status,
  ownerId: t.kind === 'habit' ? (t.ownerId ?? '') : '',
  availableTo: t.kind === 'quest' ? t.availableTo : '',
  frequency: t.kind === 'habit' ? String(t.frequencyDays) : '',
  lastDone: t.lastDone != null ? dayKey(t.lastDone) : '',
  completedAt: t.kind === 'quest' ? t.completedAt : undefined,
});

/** Builds the typed tend from the form, or says what needs fixing. */
function toTend(f: Form): { tend: Parameters<typeof saveTend>[0] } | { errors: string[] } {
  const errors: string[] = [];
  if (!f.name.trim()) errors.push('Give it a name.');
  if (!f.roomId) errors.push(f.kind === 'quest' ? 'Choose a room, or “No room” for a quest done out and about.' : 'Choose which room it belongs to.');
  if (f.kind === 'habit' && f.roomId === NO_ROOM) errors.push('A habit needs a room. (Only quests can have none.)');
  if (!f.impact) errors.push('Choose its ecological impact: how much the room suffers if it waits.');
  if (f.kind === 'quest' && (f.availableTo === '' || (Array.isArray(f.availableTo) && f.availableTo.length === 0)))
    errors.push('Choose who can take this quest on: everyone, or particular members.');
  if (f.description.length > DESCRIPTION_MAX) errors.push(`Keep the description under ${DESCRIPTION_MAX} characters.`);
  const days = Number(f.frequency);
  if (f.kind === 'habit' && !(Number.isInteger(days) && days >= 1 && days <= 3650)) errors.push('A habit needs to say how often: every 1 to 3650 days.');
  if (errors.length || !f.impact || (f.kind === 'quest' && f.availableTo === '')) return { errors };

  const common = {
    id: f.id,
    name: f.name.trim(),
    impact: f.impact,
    ...(f.group.trim() && { group: f.group.trim() }),
    ...(f.description.trim() && { description: f.description.trim() }),
    tier: f.tier,
    energy: f.energy,
    status: f.status,
    ...(f.lastDone && { lastDone: parseDay(f.lastDone) }),
  };
  return {
    tend:
      f.kind === 'habit'
        ? { ...common, kind: 'habit', roomId: f.roomId, frequencyDays: days, ...(f.ownerId && { ownerId: f.ownerId }) }
        : {
            ...common,
            kind: 'quest',
            availableTo: f.availableTo as 'everyone' | string[],
            ...(f.roomId !== NO_ROOM && { roomId: f.roomId }),
            ...(f.completedAt != null && { completedAt: f.completedAt }),
          },
  };
}

function TendEditor({ initial, onClose }: { initial: Form; onClose(): void }) {
  const { tends, members, rooms } = useHabitat();
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [newRoom, setNewRoom] = useState<string>();
  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });
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
          <select
            value={newRoom !== undefined ? '__new' : f.roomId}
            onChange={(e) => {
              if (e.target.value === '__new') return setNewRoom('');
              setNewRoom(undefined);
              set({ roomId: e.target.value });
            }}
          >
            <option value="" disabled>
              Choose a room…
            </option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {roomIcon(r)} {r.name}
              </option>
            ))}
            {f.kind === 'quest' && (
              <option value={NO_ROOM}>
                {OUT_AND_ABOUT.icon} No room (out and about)
              </option>
            )}
            <option value="__new">＋ New room…</option>
          </select>
        </label>
        <label className="field">
          <span>Group (for “do all”)</span>
          <input list="groups" value={f.group} onChange={(e) => set({ group: e.target.value })} placeholder="e.g. Empty Bins" maxLength={40} />
        </label>
      </div>
      {newRoom !== undefined && (
        <div className="row">
          <input value={newRoom} onChange={(e) => setNewRoom(e.target.value)} placeholder="New room’s name" maxLength={40} aria-label="New room’s name" autoFocus />
          <button
            type="button"
            className="btn-soft"
            style={{ flex: 'none' }}
            disabled={!newRoom.trim()}
            onClick={async () => {
              try {
                const id = await saveRoom({ name: newRoom });
                setNewRoom(undefined);
                set({ roomId: id });
              } catch (e) {
                setErrors([e instanceof Error ? e.message : 'Couldn’t add that room.']);
              }
            }}
          >
            Add room
          </button>
        </div>
      )}
      <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>

      <label className="field">
        <span>Instructions (optional; one step per line)</span>
        <textarea
          value={f.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={4}
          maxLength={DESCRIPTION_MAX}
          placeholder={'e.g.\nTake the bag out of the bin\nTie it and put it in the outside bin\nPut a new bag in'}
        />
      </label>

      <fieldset className="field">
        <legend>Ecological impact: how much the room suffers if it waits</legend>
        <div className="chips">
          {IMPACT_ORDER.map((impact) => (
            <button type="button" key={impact} className={`chip${f.impact === impact ? ' on' : ''}`} aria-pressed={f.impact === impact} onClick={() => set({ impact })} title={IMPACTS[impact].hint}>
              {IMPACTS[impact].emoji} {IMPACTS[impact].label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Effort: how much energy it takes</legend>
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

      {f.kind === 'habit' ? (
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
      ) : (
        <fieldset className="field">
          <legend>Who can take it on? It only appears on their Quests menu.</legend>
          <div className="chips wrap">
            <button type="button" className={`chip${f.availableTo === 'everyone' ? ' on' : ''}`} aria-pressed={f.availableTo === 'everyone'} onClick={() => set({ availableTo: 'everyone' })}>
              🐾 Everyone
            </button>
            {members.map((m) => {
              const on = Array.isArray(f.availableTo) && f.availableTo.includes(m.id);
              const picked = Array.isArray(f.availableTo) ? f.availableTo : [];
              return (
                <button
                  type="button"
                  key={m.id}
                  className={`chip${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => set({ availableTo: on ? picked.filter((x) => x !== m.id) : [...picked, m.id] })}
                >
                  {m.animal} {m.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

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

type View = 'habit' | 'quest' | 'completed' | 'rooms';

/** The master list of habits, quests and rooms, to add, change, pause, remove or restart. */
export function Tending() {
  const { tends, rooms, roomById, roomName, memberById } = useHabitat();
  const questFor = (a: 'everyone' | string[]) =>
    a === 'everyone' ? 'for everyone' : a.length === 0 ? '⚠️ nobody can take it on' : `for ${a.map((id) => memberById.get(id)?.name ?? '?').join(', ')}`;
  const [view, setView] = useState<View>('habit');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [editing, setEditing] = useState<Form>();

  const completed = completedQuests(tends);
  const counts: Record<View, number> = {
    habit: tends.filter((t) => t.kind === 'habit').length,
    quest: tends.filter((t) => t.kind === 'quest' && t.completedAt == null).length,
    completed: completed.length,
    rooms: rooms.length,
  };
  // Quests with no room sort last.
  const roomOrder = (id?: string) => (id ? (roomById.get(id)?.sortOrder ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER);
  const inView = view === 'completed' ? completed : tends.filter((t) => t.kind === view && (view === 'habit' || t.completedAt == null));
  const shown = inView
    .filter((t) => matchesQuery(t, query, roomName(t.roomId)) && (!paused || t.status === 'paused'))
    .sort((a, b) => roomOrder(a.roomId) - roomOrder(b.roomId) || a.name.localeCompare(b.name));

  const rowButton = (t: Tend, showRoom: boolean) => (
    <button className="admin-row" onClick={() => setEditing(toForm(t))}>
      <span>
        {TIERS[t.tier].emoji} {t.name}
        {t.description ? ' 📝' : ''}
      </span>
      <span className="muted small">
        {showRoom ? `${t.roomId ? roomName(t.roomId) : OUT_AND_ABOUT.name} · ` : ''}
        {t.kind === 'habit' ? `every ${t.frequencyDays}d` : t.completedAt != null ? `done ${new Date(t.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'one-off'}
        {t.kind === 'quest' && ` · ${questFor(t.availableTo)}`}
        {` · ${IMPACTS[t.impact].label} impact`}
        {t.status === 'paused' ? ' · Paused' : ''}
      </span>
    </button>
  );
  const row = (t: Tend, showRoom: boolean) => <li key={t.id}>{rowButton(t, showRoom)}</li>;

  // Searching shows matches flat; otherwise rooms stay folded, so it's never a wall of 200 tends.
  const flat = query.trim() !== '' || paused || view === 'completed';
  const roomsShown: { id: string; name: string; icon: string }[] = rooms
    .filter((r) => shown.some((t) => t.roomId === r.id))
    .map((r) => ({ id: r.id, name: r.name, icon: roomIcon(r) }));
  if (shown.some((t) => !t.roomId)) roomsShown.push({ id: NO_ROOM, ...OUT_AND_ABOUT });
  const views: [View, string][] = [
    ['habit', `${KINDS.habit.emoji} Habits`],
    ['quest', `${KINDS.quest.emoji} Quests`],
    ['completed', '🏆 Completed'],
    ['rooms', '🏠 Rooms'],
  ];

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>Tending</h2>
        <p className="muted">Everything that looks after the habitat: habits that come back, one-off quests, and the rooms they belong to.</p>
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

          {view === 'rooms' ? (
            <RoomsAdmin />
          ) : (
            <>
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
                  {roomsShown.map((room) => {
                    const inRoom = shown.filter((t) => (room.id === NO_ROOM ? !t.roomId : t.roomId === room.id));
                    return (
                      <details key={room.id} className="room-group">
                        <summary>
                          <span>
                            {room.icon} {room.name}
                          </span>
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
        </>
      )}
    </section>
  );
}

/** A few friendly icons to pick from; any emoji can be typed instead. */
const ROOM_ICONS = ['🍳', '🛁', '🛏️', '🛋️', '🍽️', '🚪', '🌻', '🐾', '🏡', '🧺', '🚗', '📚', '🧸', '💻', '🪴', '🧹'];

function RoomEditor({ room, onDone }: { room?: Room; onDone(): void }) {
  const [name, setName] = useState(room?.name ?? '');
  const [icon, setIcon] = useState(room?.icon ?? '');
  const [error, setError] = useState<string>();
  return (
    <form
      className="panel stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await saveRoom({ id: room?.id, name, icon });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Couldn’t save that room.');
        }
      }}
    >
      <label className="field">
        <span>Room name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Leo’s room" autoFocus />
      </label>
      <fieldset className="field">
        <legend>Icon (optional)</legend>
        <div className="animals">
          {ROOM_ICONS.map((i) => (
            <button key={i} type="button" className={`animal${icon === i ? ' on' : ''}`} aria-pressed={icon === i} onClick={() => setIcon(icon === i ? '' : i)}>
              {i}
            </button>
          ))}
        </div>
        <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={16} placeholder="Or type any emoji" aria-label="Room icon" />
      </fieldset>
      {error && <p className="small error-text">{error}</p>}
      <div className="actions">
        <button className="btn-done" disabled={!name.trim()}>
          Save
        </button>
        <button type="button" className="btn-soft" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Add, rename, re-icon, reorder and remove rooms. A room still holding habits or quests can't be removed. */
function RoomsAdmin() {
  const { rooms, tends } = useHabitat();
  const [editing, setEditing] = useState<Room | 'new'>();
  const [error, setError] = useState<string>();

  if (editing) return <RoomEditor room={editing === 'new' ? undefined : editing} onDone={() => setEditing(undefined)} />;

  return (
    <div className="stack">
      <button className="btn-done" onClick={() => setEditing('new')}>
        ＋ Add a room
      </button>
      <p className="muted small">The order here is the order everywhere: the Habitat overview, Forage and Quests.</p>
      {error && <p className="small error-text">{error}</p>}
      {rooms.length === 0 && <p className="empty">No rooms yet.</p>}
      <ul className="admin-list">
        {rooms.map((room, i) => {
          const count = tends.filter((t) => t.roomId === room.id).length;
          return (
            <li key={room.id} className="room-admin-row">
              <button className="admin-row" onClick={() => setEditing(room)}>
                <span>
                  {roomIcon(room)} {room.name}
                </span>
                <span className="muted small">{count === 1 ? '1 habit or quest' : `${count} habits and quests`}</span>
              </button>
              <button className="icon-btn" disabled={i === 0} onClick={() => void moveRoom(room.id, -1)} aria-label={`Move ${room.name} up`}>
                ↑
              </button>
              <button className="icon-btn" disabled={i === rooms.length - 1} onClick={() => void moveRoom(room.id, 1)} aria-label={`Move ${room.name} down`}>
                ↓
              </button>
              {count === 0 && (
                <ConfirmButton
                  className="icon-btn"
                  question={`Remove ${room.name}?`}
                  confirmLabel="Yes, remove it"
                  onConfirm={async () => {
                    setError(undefined);
                    try {
                      await deleteRoom(room.id);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Couldn’t remove that room.');
                    }
                  }}
                >
                  🗑️
                </ConfirmButton>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
