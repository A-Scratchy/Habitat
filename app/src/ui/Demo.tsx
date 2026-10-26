import { useState } from 'react';
import { leaveDemo } from '../data/example';

/** A gentle reminder, on every screen of the demo, that it's pretend and how to get out. */
export function DemoBanner() {
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="demo-banner" role="note">
      <span>👀 This is a demo habitat. Try anything: it stays on this device and nothing is real.</span>
      <button
        className="btn-soft"
        disabled={leaving}
        onClick={async () => {
          setLeaving(true);
          await leaveDemo();
        }}
      >
        {leaving ? 'Leaving…' : 'Leave demo'}
      </button>
    </div>
  );
}
