import { useState } from 'react';
import { deleteMember, deleteTask, importTasks, resetEverything, saveMember, saveTask } from '../data/actions';
import { parseChoresCsv, toChoresCsv } from '../domain/csv';
import { dayKey, parseDay } from '../domain/dates';
import { matchesQuery } from '../domain/selection';
import { ENERGY, ENERGY_ORDER, STATUSES, TIER_ORDER, TIERS, type Task, type TaskStatus } from '../domain/types';
import { AnimalPicker, NewMemberForm } from './Members';
import { useHabitat } from './habitat';
import { loadExample } from './Welcome';

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
      <h3>{t.id ? 'Edit task' : 'New task'}</h3>
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
          <button
            type="button"
            className="link danger"
            onClick={async () => {
              if (confirm(`Remove “${t.name}”? Past wins stay in the log.`)) {
                await deleteTask(t.id!);
                onClose();
              }
            }}
          >
            Remove task
          </button>
        )}
      </div>
    </form>
  );
}

function TasksAdmin() {
  const { tasks } = useHabitat();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [editing, setEditing] = useState<Draft>();
  const shown = tasks
    .filter((t) => matchesQuery(t, query) && (!status || t.status === status))
    .sort((a, b) => a.room.localeCompare(b.room) || a.name.localeCompare(b.name));

  if (editing) return <TaskEditor draft={editing} onClose={() => setEditing(undefined)} />;

  return (
    <div className="stack">
      <div className="row">
        <input className="search" type="search" placeholder="Find a task" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a task" />
        <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | '')} aria-label="Status">
          <option value="">All ({tasks.length})</option>
          {(Object.keys(STATUSES) as TaskStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUSES[s]} ({tasks.filter((t) => t.status === s).length})
            </option>
          ))}
        </select>
      </div>
      <button className="btn-soft" onClick={() => setEditing(blankTask())}>
        ＋ Add a task
      </button>
      <ul className="admin-list">
        {shown.slice(0, 60).map((t) => (
          <li key={t.id}>
            <button className="admin-row" onClick={() => setEditing(t)}>
              <span>
                {TIERS[t.tier].emoji} {t.name}
              </span>
              <span className="muted small">
                {t.room} · {t.frequencyDays ? `every ${t.frequencyDays}d` : 'no schedule'}
                {t.status !== 'active' ? ` · ${STATUSES[t.status]}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length > 60 && <p className="muted small">Showing 60 of {shown.length}. Search to narrow it down.</p>}
    </div>
  );
}

function MembersAdmin() {
  const { members, me, setMe } = useHabitat();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string>();

  return (
    <div className="stack">
      {members.map((m) =>
        editId === m.id ? (
          <div key={m.id} className="panel stack">
            <label className="field">
              <span>Name</span>
              <input defaultValue={m.name} onBlur={(e) => e.target.value.trim() && void saveMember({ ...m, name: e.target.value.trim() })} />
            </label>
            <AnimalPicker value={m.animal} onChange={(animal) => void saveMember({ ...m, animal })} />
            <div className="actions">
              <button className="btn-soft" onClick={() => setEditId(undefined)}>
                Done
              </button>
              {m.id !== me?.id && (
                <button
                  className="link danger"
                  onClick={async () => {
                    if (confirm(`Remove ${m.name} from the pack? Their past wins stay.`)) await deleteMember(m.id);
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ) : (
          <button key={m.id} className="admin-row" onClick={() => setEditId(m.id)}>
            <span>
              {m.animal} {m.name}
              {m.id === me?.id ? ' (this device)' : ''}
            </span>
            <span className="muted small">Edit</span>
          </button>
        ),
      )}
      {adding ? (
        <NewMemberForm onSaved={() => setAdding(false)} />
      ) : (
        <button className="btn-soft" onClick={() => setAdding(true)}>
          ＋ Add someone
        </button>
      )}
      <button className="link" onClick={() => setMe(undefined)}>
        Switch who’s using this device
      </button>
    </div>
  );
}

function DataAdmin() {
  const { tasks, members } = useHabitat();
  const [replace, setReplace] = useState(true);
  const [mockDates, setMockDates] = useState(true);
  const [report, setReport] = useState<string[]>();

  const onFile = async (file: File) => {
    const { tasks: parsed, warnings } = parseChoresCsv(await file.text());
    if (parsed.length === 0) return setReport(warnings.length ? warnings : ['No tasks found in that file.']);
    if (replace && tasks.length && !confirm(`Replace all ${tasks.length} tasks and this week’s wins with ${parsed.length} from the file?`)) return;
    const n = await importTasks(parsed, { replace, mockDates });
    setReport([`Imported ${n} tasks.`, ...warnings]);
  };

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toChoresCsv(tasks, members)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `habitat-chores-${dayKey(Date.now())}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="stack">
      <p className="muted small">
        CSV columns: Chore Name, Room, Chore Group, Effort Tier, Energy Type, Frequency (Days), Last Done Date, Permanent Owner, Task status. Other columns are ignored.
      </p>
      <label className="check">
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace existing tasks
      </label>
      <label className="check">
        <input type="checkbox" checked={mockDates} onChange={(e) => setMockDates(e.target.checked)} /> Make up pretend “last done” dates (for trying things out)
      </label>
      <label className="btn-soft file">
        Import a CSV…
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} hidden />
      </label>
      {report && (
        <ul className="report small">
          {report.slice(0, 12).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
          {report.length > 12 && <li>…and {report.length - 12} more notes.</li>}
        </ul>
      )}
      <button className="btn-soft" onClick={exportCsv}>
        Export tasks as CSV
      </button>
      <button
        className="btn-soft"
        onClick={async () => {
          if (confirm('Reload the example household? This replaces all tasks and wins.')) await loadExample();
        }}
      >
        Reload example household
      </button>
      <button
        className="link danger"
        onClick={async () => {
          if (confirm('Clear everything on this device: tasks, pack and wins?')) await resetEverything();
        }}
      >
        Clear everything
      </button>
    </div>
  );
}

export function Settings() {
  const [tab, setTab] = useState<'tasks' | 'pack' | 'data'>('tasks');
  return (
    <section className="screen">
      <header className="screen-head">
        <h2>Settings</h2>
      </header>
      <div className="chips" role="tablist">
        {(
          [
            ['tasks', '📋 Tasks'],
            ['pack', '🐾 The pack'],
            ['data', '📦 Import & export'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`chip${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'tasks' && <TasksAdmin />}
      {tab === 'pack' && <MembersAdmin />}
      {tab === 'data' && <DataAdmin />}
    </section>
  );
}
