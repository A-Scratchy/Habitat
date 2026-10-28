/*
 * The app is designed for phones held upright. The installed Android app is locked to portrait by
 * the manifest; everywhere else (iPhones, phones in a browser tab) a website can't lock it, so a
 * phone turned sideways gets a calm "turn it upright" screen instead of a squashed layout.
 * Tablets and computers are left alone: the layout works at their sizes either way round.
 */

/** Shorter side of the screen, in CSS pixels, below which a device counts as a phone. */
const PHONE_MAX_SHORT_SIDE = 500;

const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < PHONE_MAX_SHORT_SIDE;

/**
 * Uses the device's orientation rather than the page's shape, so a portrait phone with the
 * keyboard open (which makes the page wider than it is tall) isn't mistaken for sideways.
 */
function sideways(): boolean {
  if (screen.orientation?.type) return screen.orientation.type.startsWith('landscape');
  return matchMedia('(orientation: landscape)').matches;
}

function update(): void {
  document.documentElement.toggleAttribute('data-sideways', isPhone() && sideways());
}

export function watchOrientation(): void {
  update();
  screen.orientation?.addEventListener('change', update);
  // Older iPhones have no screen.orientation; the page resizing covers them.
  window.addEventListener('resize', update);
}
