export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday 00:00 local of the week containing t. */
export function startOfWeek(t: number): number {
  const d = new Date(startOfDay(t));
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  return d.getTime();
}

/** Whole calendar days from `from` to `to` (rounded, so DST shifts don't matter). */
export function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY);
}

/** Parses YYYY-MM-DD or UK-style DD/MM/YYYY to local noon. */
export function parseDay(text: string): number | undefined {
  const s = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime();
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(year, +m[2] - 1, +m[1], 12).getTime();
  }
  return undefined;
}

export function timeOfDay(t: number): string {
  return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
