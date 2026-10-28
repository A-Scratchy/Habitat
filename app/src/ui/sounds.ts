import type { CompletionSound } from '../domain/types';

/*
 * Gentle sounds for finishing something, made on the spot with the browser's audio engine:
 * no files to download or license. Every sound is short, soft (well below full volume) and
 * fades out; nothing is sharp or sudden.
 */

export const SOUNDS: Record<CompletionSound, { emoji: string; label: string }> = {
  chime: { emoji: '🎐', label: 'Soft chime' },
  bell: { emoji: '🔔', label: 'Little bell' },
  wood: { emoji: '🪵', label: 'Wood knock' },
  birdsong: { emoji: '🐦', label: 'Birdsong' },
  bubble: { emoji: '🫧', label: 'Bubble' },
  harp: { emoji: '🎵', label: 'Harp' },
  none: { emoji: '🤫', label: 'No sound' },
};

/** Overall loudness: quiet on purpose. */
const VOLUME = 0.12;

let audio: AudioContext | undefined;

/**
 * Browsers only let a page start sound straight after a tap. Call this at the start of the tap
 * (before waiting on the server), so the sound can still play once the change is saved.
 */
export function primeSound(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    // No audio on this device: finishing things just stays quiet.
  }
}

/** One soft note: a tone that starts gently and fades away. `glideTo` bends the pitch as it plays. */
function note(ctx: AudioContext, o: { freq: number; at: number; length: number; type?: OscillatorType; level?: number; glideTo?: number }): void {
  const start = ctx.currentTime + o.at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, start);
  if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, start + o.length * 0.6);
  const peak = VOLUME * (o.level ?? 1);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + o.length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + o.length + 0.05);
}

const PLAY: Record<Exclude<CompletionSound, 'none'>, (ctx: AudioContext) => void> = {
  chime: (ctx) => {
    note(ctx, { freq: 659.25, at: 0, length: 0.9 }); // E5
    note(ctx, { freq: 880, at: 0.12, length: 1.1 }); // A5
  },
  bell: (ctx) => {
    note(ctx, { freq: 523.25, at: 0, length: 1.6 }); // C5
    note(ctx, { freq: 1313, at: 0, length: 0.9, level: 0.25 }); // the bell's shimmer
  },
  wood: (ctx) => {
    note(ctx, { freq: 340, glideTo: 190, at: 0, length: 0.16, type: 'triangle', level: 1.4 });
  },
  birdsong: (ctx) => {
    note(ctx, { freq: 2300, glideTo: 3100, at: 0, length: 0.12, level: 0.45 });
    note(ctx, { freq: 2500, glideTo: 3400, at: 0.16, length: 0.14, level: 0.45 });
  },
  bubble: (ctx) => {
    note(ctx, { freq: 280, glideTo: 900, at: 0, length: 0.2 });
  },
  harp: (ctx) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => note(ctx, { freq, at: i * 0.07, length: 0.8, type: 'triangle', level: 0.8 }));
  },
};

/** Plays someone's chosen sound. Quietly does nothing if they chose silence or audio isn't available. */
export function playSound(sound: CompletionSound): void {
  if (sound === 'none') return;
  primeSound();
  if (!audio) return;
  try {
    PLAY[sound](audio);
  } catch {
    // Audio refused (e.g. blocked by the browser): stay quiet rather than get in the way.
  }
}
