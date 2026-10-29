import { setMeadowShown, useMeadowShown } from './settings';

/** The on/off switch for Settings. */
export function MeadowSetting() {
  const shown = useMeadowShown();
  return (
    <label className="check">
      <input type="checkbox" checked={shown} onChange={(e) => setMeadowShown(e.target.checked)} /> Show who’s around: animals in a little meadow at the bottom (this device)
    </label>
  );
}
