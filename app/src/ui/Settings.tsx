import { useState } from 'react';
import { deleteMember, importTends, resetEverything, saveMember } from '../data/actions';
import { parseTendsCsv, toTendsCsv } from '../domain/csv';
import { dayKey } from '../domain/dates';
import { AccountAdmin } from './Account';
import { ConfirmButton, ConfirmPanel } from './Confirm';
import { AnimalPicker, NewMemberForm, SoundPicker } from './Members';
import { useHabitat } from './habitat';
import { loadExample } from '../data/example';
import { MeadowSetting } from '../meadow/MeadowSetting';
import { isRemote } from '../data/remote';

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
            <fieldset className="field">
              <legend>Sound when they finish something</legend>
              <SoundPicker value={m.sound} onChange={(sound) => void saveMember({ ...m, sound })} />
            </fieldset>
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
      <MeadowSetting />
      <button className="link" onClick={() => setMe(undefined)}>
        Switch who’s using this device
      </button>
    </div>
  );
}

function DataAdmin() {
  const { tends, members, rooms } = useHabitat();
  const [replace, setReplace] = useState(true);
  const remote = isRemote();
  // A connected habitat's wins are real, so it never gets pretend history.
  const [mockDates, setMockDates] = useState(!remote);
  const [report, setReport] = useState<string[]>();
  /** A parsed file waiting for "yes, replace" before it overwrites the current tends. */
  const [pending, setPending] = useState<ReturnType<typeof parseTendsCsv>>();

  const runImport = async ({ tends: parsed }: ReturnType<typeof parseTendsCsv>) => {
    setPending(undefined);
    const n = await importTends(parsed, { replace, mockDates });
    const quests = parsed.filter((t) => t.kind === 'quest').length;
    setReport([`Imported ${n - quests} habits and ${quests} quests.`]);
  };

  const onFile = async (file: File) => {
    const result = parseTendsCsv(await file.text());
    setReport(undefined);
    // Strict: any problem means nothing is imported, and every problem is listed.
    if (result.errors.length) return setReport(['Nothing was imported. Please fix these in the file and try again:', ...result.errors]);
    if (result.tends.length === 0) return setReport(['There are no habits or quests in that file.']);
    if (replace && tends.length) return setPending(result);
    await runImport(result);
  };

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toTendsCsv(tends, members, rooms)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `habitat-tending-${dayKey(Date.now())}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="stack">
      <p className="muted small">
        CSV columns: Name, <strong>Room</strong> (required; new names become new rooms), Group, <strong>Kind</strong> (Habit or Quest, required), <strong>Ecological Impact</strong> (Small, Medium or Large, required), Description, Effort Tier, Energy Type, Frequency (Days: required for habits, blank for quests), Last Done Date, Permanent Owner, Status (Active, Paused, or Done for finished quests). Other columns are ignored.
      </p>
      <label className="check">
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace existing habits and quests
      </label>
      {!remote && (
        <label className="check">
          <input type="checkbox" checked={mockDates} onChange={(e) => setMockDates(e.target.checked)} /> Make up pretend “last done” dates (for trying things out)
        </label>
      )}
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
          question={
            remote
              ? `Replace all ${tends.length} habits and quests in the habitat with ${pending.tends.length} from the file? The pack’s past wins stay.`
              : `Replace all ${tends.length} habits and quests, and this week’s wins, with ${pending.tends.length} from the file?`
          }
          confirmLabel="Yes, replace them"
          onConfirm={() => runImport(pending)}
          onCancel={() => setPending(undefined)}
        />
      )}
      {report && (
        <ul className="report small">
          {report.slice(0, 15).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
          {report.length > 15 && <li>…and {report.length - 15} more.</li>}
        </ul>
      )}
      <button className="btn-soft" onClick={exportCsv}>
        Export habits and quests as CSV
      </button>
      {remote ? (
        <ConfirmButton question="Throw away this device’s copy and download the whole habitat again? Nothing in the habitat changes." confirmLabel="Yes, download again" onConfirm={resetEverything}>
          Download everything again
        </ConfirmButton>
      ) : (
        <>
          <ConfirmButton question="Reload the example household? This replaces all habits, quests and wins." confirmLabel="Yes, reload it" onConfirm={loadExample}>
            Reload example household
          </ConfirmButton>
          <ConfirmButton className="link danger" question="Clear everything on this device: habits, quests, pack and wins?" confirmLabel="Yes, clear everything" onConfirm={resetEverything}>
            Clear everything
          </ConfirmButton>
        </>
      )}
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
