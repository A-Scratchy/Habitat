import { useState } from 'react';
import { deleteTask, saveTask } from '../data/actions';
import { dayKey, parseDay } from '../domain/dates';
import { matchesQuery } from '../domain/selection';
import { ENERGY, ENERGY_ORDER, STATUSES, TIER_ORDER, TIERS, type Task, type TaskStatus } from '../domain/types';
import { ConfirmButton } from './Confirm';
import { useHabitat } from './habitat';

type Draft = Omit<Task, 'id'> & { id?: string };

const blankTask = (room = ''): Draft => ({ name: '', room, tier: 'tortoise', energy: [], status: 'active', frequencyDays: 7 });

function TaskEditor({ draft, onClose }: { draft: Draft; onClose(): void }) {
  const { tasks, members } = useHabitat();
  const [t, setT] = useState(draft);
  const set = (patch: Partial<Draft>) => setT({ ...t, ...patch });
  const rooms = [...new Set(tasks.map((x) => x.room))].sort();
  const groups = [...new Set(tasks.map((x) => x.group).filter(Boolean))].sort();

  return (
    <form
      className="panel stack editor"
      onSubmit={async (e) => {
        e.preventDefault();
        await saveTask({ ...t, name: t.name.trim(), room: t.room.trim() || 'General', group: t.group?.trim() || undefined });
        onClose();
      }}
    >
      <h3>{t.id ? 'Edit chore' : 'New chore'}</h3>
      <label className="field">
        <span>Name</span>
        <input required value={t.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="row">
        <label className="field">
          <span>Room</span>
          <input list="rooms" value={t.room} onChange={(e) => set({ room: e.target.value })} />
        </label>
        <label className="field">
          <span>Group (for “do all”)</span>
          <input list="groups" value={t.group ?? ''} onChange={(e) => set({ group: e.target.value })} placeholder="e.g. Empty Bins" />
        </label>
      </div>
      <datalist id="rooms">{rooms.map((r) => <option key={r} value={r} />)}</datalist>
      <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>

      <fieldset className="field">
        <legend>Effort</legend>
        <div className="chips">
          {TIER_ORDER.map((tier) => (
            <button type="button" key={tier} className={`chip${t.tier === tier ? ' on' : ''}`} aria-pressed={t.tier === tier} onClick={() => set({ tier })} title={TIERS[tier].hint}>
              {TIERS[tier].emoji} {TIERS[tier].label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Energy type</legend>
        <div className="chips">
          {ENERGY_ORDER.map((e) => {
            const on = t.energy.includes(e);
            return (
              <button type="button" key={e} className={`chip${on ? ' on' : ''}`} aria-pressed={on} title={ENERGY[e].hint} onClick={() => set({ energy: on ? t.energy.filter((x) => x !== e) : [...t.energy, e] })}>
                {ENERGY[e].emoji} {ENERGY[e].label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Status</legend>
        <div className="chips">
          {(Object.keys(STATUSES) as TaskStatus[]).map((s) => (
            <button type="button" key={s} className={`chip${t.status === s ? ' on' : ''}`} aria-pressed={t.status === s} onClick={() => set({ status: s })}>
              {STATUSES[s]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="row">
        <label className="field">
          <span>Every … days</span>
          <input
            type="number"
            min={1}
            value={t.frequencyDays ?? ''}
            placeholder="No schedule"
            onChange={(e) => set({ frequencyDays: e.target.value ? Math.max(1, Math.round(+e.target.value)) : undefined })}
          />
        </label>
        <label className="field">
          <span>Last done</span>
          <input type="date" value={t.lastDone != null ? dayKey(t.lastDone) : ''} onChange={(e) => set({ lastDone: e.target.value ? parseDay(e.target.value) : undefined })} />
        </label>
      </div>

      <label className="field">
        <span>Permanent owner</span>
        <select value={t.ownerId ?? ''} onChange={(e) => set({ ownerId: e.target.value || undefined })}>
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.animal} {m.name}
            </option>
          ))}
        </select>
      </label>

      <div className="actions">
        <button className="btn-done">Save</button>
        <button type="button" className="btn-soft" onClick={onClose}>
          Cancel
        </button>
        {t.id && (
          <ConfirmButton
            className="link danger"
            question={`Remove “${t.name}”? Past wins stay in the log.`}
            confirmLabel="Yes, remove it"
            onConfirm={async () => {
              await deleteTask(t.id!);
              onClose();
            }}
          >
            Remove chore
          </ConfirmButton>
        )}
      </div>
    </form>
  );
}

/** The master list: every chore, to add, edit, pause or remove. */
export function Chores() {
  const { tasks } = useHabitat();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [editing, setEditing] = useState<Draft>();
  const shown = tasks
    .filter((t) => matchesQuery(t, query) && (!status || t.status === status))
    .sort((a, b) => a.room.localeCompare(b.room) || a.name.localeCompare(b.name));

  const row = (t: Task, showRoom: boolean) => (
    <li key={t.id}>
      <button className="admin-row" onClick={() => setEditing(t)}>
        <span>
          {TIERS[t.tier].emoji} {t.name}
        </span>
        <span className="muted small">
          {showRoom ? `${t.room} · ` : ''}
          {t.frequencyDays ? `every ${t.frequencyDays}d` : 'no schedule'}
          {t.status !== 'active' ? ` · ${STATUSES[t.status]}` : ''}
        </span>
      </button>
    </li>
  );

  // Searching or filtering shows matches flat; otherwise rooms stay folded, so it's never a wall of 200 chores.
  const filtering = query.trim() !== '' || status !== '';
  const rooms = [...new Set(shown.map((t) => t.room))];

  return (
    <section className="screen">
      <header className="screen-head">
        <h2>Chores</h2>
        <p className="muted">The master list. Add, change, pause or remove chores here.</p>
      </header>

      {editing ? (
        <TaskEditor draft={editing} onClose={() => setEditing(undefined)} />
      ) : (
        <>
          <button className="btn-done" onClick={() => setEditing(blankTask())}>
            ＋ Add a chore
          </button>
          <div className="row">
            <input className="search" type="search" placeholder="Find a chore" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a chore" />
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | '')} aria-label="Status" style={{ flex: 'none', width: 'auto' }}>
              <option value="">All ({tasks.length})</option>
              {(Object.keys(STATUSES) as TaskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUSES[s]} ({tasks.filter((t) => t.status === s).length})
                </option>
              ))}
            </select>
          </div>

          {tasks.length === 0 ? (
            <p className="empty">No chores yet. Add one above, or import a list in Settings → Import &amp; export.</p>
          ) : filtering ? (
            shown.length === 0 ? (
              <p className="empty">No chores match that.</p>
            ) : (
              <ul className="admin-list">{shown.map((t) => row(t, true))}</ul>
            )
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

