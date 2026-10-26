import { useState } from 'react';
import { deleteMember, importTasks, resetEverything, saveMember } from '../data/actions';
import { parseChoresCsv, toChoresCsv } from '../domain/csv';
import { dayKey } from '../domain/dates';
import { AccountAdmin } from './Account';
import { ConfirmButton, ConfirmPanel } from './Confirm';
import { AnimalPicker, NewMemberForm } from './Members';
import { useHabitat } from './habitat';
import { loadExample } from './Welcome';

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
                <ConfirmButton
                  className="link danger"
                  question={`Remove ${m.name} from the pack? Their past wins stay.`}
                  confirmLabel="Yes, remove"
                  onConfirm={() => deleteMember(m.id)}
                >
                  Remove
                </ConfirmButton>
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
  /** A parsed file waiting for "yes, replace" before it overwrites the current tasks. */
  const [pending, setPending] = useState<ReturnType<typeof parseChoresCsv>>();

  const runImport = async ({ tasks: parsed, warnings }: ReturnType<typeof parseChoresCsv>) => {
    setPending(undefined);
    const n = await importTasks(parsed, { replace, mockDates });
    setReport([`Imported ${n} tasks.`, ...warnings]);
  };

  const onFile = async (file: File) => {
    const result = parseChoresCsv(await file.text());
    setReport(undefined);
    if (result.tasks.length === 0) return setReport(result.warnings.length ? result.warnings : ['No tasks found in that file.']);
    if (replace && tasks.length) return setPending(result);
    await runImport(result);
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
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Clear it, so choosing the same file again still triggers a change.
            e.target.value = '';
            if (file) void onFile(file);
          }}
          hidden
        />
      </label>
      {pending && (
        <ConfirmPanel
          question={`Replace all ${tasks.length} tasks and this week’s wins with ${pending.tasks.length} from the file?`}
          confirmLabel="Yes, replace them"
          onConfirm={() => runImport(pending)}
          onCancel={() => setPending(undefined)}
        />
      )}
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
      <ConfirmButton question="Reload the example household? This replaces all tasks and wins." confirmLabel="Yes, reload it" onConfirm={loadExample}>
        Reload example household
      </ConfirmButton>
      <ConfirmButton className="link danger" question="Clear everything on this device: tasks, pack and wins?" confirmLabel="Yes, clear everything" onConfirm={resetEverything}>
        Clear everything
      </ConfirmButton>
    </div>
  );
}

export type SettingsTab = 'pack' | 'data' | 'account';

export function Settings({ initialTab }: { initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'pack');
  return (
    <section className="screen">
      <header className="screen-head">
        <h2>Settings</h2>
      </header>
      <div className="chips" role="tablist">
        {(
          [
            ['pack', '🐾 The pack'],
            ['data', '📦 Import & export'],
            ['account', '☁️ Household account'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`chip${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'pack' && <MembersAdmin />}
      {tab === 'data' && <DataAdmin />}
      {tab === 'account' && <AccountAdmin />}
    </section>
  );
}
