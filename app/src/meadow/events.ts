/** The rest of the app tells the meadow that something got done, and the pack hops. Nothing else is shared. */
const CELEBRATE = 'habitat:meadow-celebrate';

export function celebrate(): void {
  window.dispatchEvent(new Event(CELEBRATE));
}

export function onCelebrate(handler: () => void): () => void {
  window.addEventListener(CELEBRATE, handler);
  return () => window.removeEventListener(CELEBRATE, handler);
}
