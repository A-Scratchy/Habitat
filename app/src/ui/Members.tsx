import { useState } from 'react';
import { saveMember } from '../data/actions';
import { ANIMALS } from '../domain/types';
import { useHabitat } from './habitat';

export function AnimalPicker({ value, onChange }: { value: string; onChange(animal: string): void }) {
  return (
    <div className="animals" role="radiogroup" aria-label="Animal">
      {ANIMALS.map((a) => (
        <button key={a} type="button" role="radio" aria-checked={a === value} className={`animal${a === value ? ' on' : ''}`} onClick={() => onChange(a)}>
          {a}
        </button>
      ))}
    </div>
  );
}

export function NewMemberForm({ onSaved }: { onSaved(id: string): void }) {
  const { members } = useHabitat();
  const [name, setName] = useState('');
  const [animal, setAnimal] = useState(() => ANIMALS.find((a) => !members.some((m) => m.animal === a)) ?? ANIMALS[0]);
  return (
    <form
      className="panel stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSaved(await saveMember({ name: name.trim(), animal }));
        setName('');
      }}
    >
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex" />
      </label>
      <AnimalPicker value={animal} onChange={setAnimal} />
      <button className="btn-done" disabled={!name.trim()}>
        Join the pack {animal}
      </button>
    </form>
  );
}

/** "Who's here?" — remembered per device, so it's asked once. */
export function WhoIsHere() {
  const { members, setMe } = useHabitat();
  const [wantsToAdd, setAdding] = useState(false);
  const adding = wantsToAdd || members.length === 0;
  return (
    <section className="screen narrow">
      <header className="screen-head">
        <h2>Who’s here?</h2>
        <p className="muted">Tap your animal. This device will remember you.</p>
      </header>
      <div className="who">
        {members.map((m) => (
          <button key={m.id} className="who-tile" onClick={() => setMe(m.id)}>
            <span className="who-animal">{m.animal}</span>
            <span>{m.name}</span>
          </button>
        ))}
        {!adding && (
          <button className="who-tile ghost" onClick={() => setAdding(true)}>
            <span className="who-animal">＋</span>
            <span>Someone new</span>
          </button>
        )}
      </div>
      {adding && <NewMemberForm onSaved={setMe} />}
    </section>
  );
}
