import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import { isRemote } from '../data/remote';
import { comparison, packReport, PERIODS, reportSince, roundAcorns, shareReport, TIER_ACORNS, type Period } from '../domain/report';
import { TIER_ORDER, TIERS } from '../domain/types';
import { readLocal, useHabitat, writeLocal } from './habitat';

interface ChartBar {
  key: string;
  label: string;
  /** Undefined: nothing to show for that period. */
  value?: number;
  /** What the value reads as, e.g. "42 acorns". */
  text: string;
  current: boolean;
}

/** A calm single-series bar chart. Tap or hover a bar to read it; the current period is picked to start with. */
function BarChart({ title, bars, max, guide }: { title: string; bars: ChartBar[]; max?: number; guide?: { value: number; label: string } }) {
  const [picked, setPicked] = useState<string>();
  const top = max ?? Math.max(1, ...bars.map((b) => b.value ?? 0));
  const shown = bars.find((b) => b.key === picked) ?? bars.find((b) => b.current) ?? bars[bars.length - 1];
  return (
    <figure className="panel rpt-chart">
      <figcaption className="rpt-chart-head">
        <span className="muted small">{title}</span>
        <span className="small" aria-live="polite">
          <strong>{shown.label}</strong>: {shown.text}
        </span>
      </figcaption>
      <div className="rpt-bars" onMouseLeave={() => setPicked(undefined)}>
        {guide && (
          <div className="rpt-guide" style={{ bottom: `calc(22px + ${guide.value / top} * 112px)` }}>
            <span>{guide.label}</span>
          </div>
        )}
        {bars.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`rpt-bar${b.current ? ' current' : ''}${shown.key === b.key ? ' picked' : ''}`}
            aria-label={`${b.label}: ${b.text}`}
            onMouseEnter={() => setPicked(b.key)}
            onFocus={() => setPicked(b.key)}
            onClick={() => setPicked(b.key)}
          >
            <span className="rpt-bar-track">
              {b.value != null && b.value > 0 && <span className="rpt-bar-fill" style={{ height: `${(b.value / top) * 100}%` }} />}
            </span>
            <span className="rpt-bar-label">{b.label}</span>
          </button>
        ))}
      </div>
    </figure>
  );
}

/** A labelled horizontal bar, for "how much of it" rows. */
function Meter({ label, value, max, text, strong }: { label: string; value: number; max: number; text: string; strong?: boolean }) {
  return (
    <div className={`rpt-meter${strong ? ' strong' : ''}`}>
      <div className="rpt-meter-top">
        <span>{label}</span>
        <span className="muted small">{text}</span>
      </div>
      <div className="rpt-meter-track">{value > 0 && <span style={{ width: `${Math.max(2, (value / Math.max(1, max)) * 100)}%` }} />}</div>
    </div>
  );
}

const acorns = (n: number) => `${roundAcorns(n)} ${roundAcorns(n) === 1 ? 'acorn' : 'acorns'}`;

function PackView({ period, wins }: { period: Period; wins: Parameters<typeof packReport>[0] }) {
  const { tends, rooms, ctx } = useHabitat();
  const r = useMemo(() => packReport(wins, tends, rooms, period, ctx.now), [wins, tends, rooms, period, ctx.now]);
  const p = PERIODS[period];
  const roomMax = Math.max(1, ...r.rooms.map((x) => x.acorns));
  const tierMax = Math.max(1, ...r.tiers.map((x) => x.acorns));
  const small = r.tiers.filter((t) => t.tier === 'sloth' || t.tier === 'tortoise').reduce((n, t) => n + t.acorns, 0);

  return (
    <div className="stack">
      <div className="panel rpt-hero">
        <strong>{r.acorns} 🌰</strong>
        <span>
          acorns of care {p.this} · {r.done} {r.done === 1 ? 'thing' : 'things'} done
        </span>
        <span className="muted small">{comparison(r)}</span>
      </div>

      <BarChart
        title={`The pack’s acorns, last ${p.bars} ${period === 'day' ? 'days' : period === 'week' ? 'weeks' : 'months'}`}
        bars={r.bars.map((b) => ({ key: String(b.start), label: b.current ? (period === 'day' ? 'Today' : 'Now') : b.label, value: b.acorns, text: `${acorns(b.acorns)}, ${b.done} done`, current: b.current }))}
      />

      <h3 className="section-title">Where the care went</h3>
      {r.rooms.length ? (
        <div className="panel stack">
          {r.rooms.map((x) => (
            <Meter key={x.key} label={`${x.icon} ${x.name}`} value={x.acorns} max={roomMax} text={`${acorns(x.acorns)} · ${x.done} done`} />
          ))}
        </div>
      ) : (
        <p className="empty">Nothing logged {p.this} yet.</p>
      )}

      <h3 className="section-title">Big jobs and small</h3>
      <div className="panel stack">
        {r.tiers.map((t) => (
          <Meter key={t.tier} label={`${TIERS[t.tier].emoji} ${TIERS[t.tier].label}`} value={t.acorns} max={tierMax} text={`${t.done} done · ${acorns(t.acorns)}`} />
        ))}
        {r.acorns > 0 && small > 0 && (
          <p className="muted small">
            Small jobs (🦥 and 🐢) made up {Math.round((small / r.acorns) * 100)}% of the care. Little things add up.
          </p>
        )}
      </div>

      {r.whenNeeded > 0 && (
        <div className="panel">
          🌼 <strong>{r.whenNeeded}</strong> when-needed {r.whenNeeded === 1 ? 'job' : 'jobs'} {p.this}: the behind-the-scenes care that never shows as overdue.
        </div>
      )}

      {period !== 'day' && r.quiet.length > 0 && (
        <>
          <h3 className="section-title">Rooms that went quiet</h3>
          <div className="panel stack">
            <div className="rpt-quiet">
              {r.quiet.map((room) => (
                <span key={room.id} className="tag">
                  {room.icon || '🏠'} {room.name}
                </span>
              ))}
            </div>
            <p className="muted small">Nothing logged here {p.this}. Nothing to worry about: just somewhere to look next.</p>
          </div>
        </>
      )}

      <p className="muted small center-text">
        Acorns weigh effort: {TIER_ORDER.map((t) => `${TIERS[t].emoji} ${TIER_ACORNS[t]}`).join(' · ')}
      </p>
    </div>
  );
}

function ShareView({ period, wins }: { period: Period; wins: Parameters<typeof packReport>[0] }) {
  const { members, me, ctx } = useHabitat();
  const focusId = me!.id;
  const r = useMemo(() => shareReport(wins, members, focusId, period, ctx.now), [wins, members, focusId, period, ctx.now]);
  const p = PERIODS[period];
  const mine = r.members.find((m) => m.member.id === focusId);
  const max = Math.max(1, ...r.members.map((m) => m.acorns));
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <div className="stack">
      <div className="panel rpt-hero">
        {r.total > 0 && mine ? (
          <>
            <strong>{pct(mine.acorns / r.total)}</strong>
            <span>
              your share of the pack’s {acorns(r.total)} {p.this}
            </span>
          </>
        ) : (
          <span>Nothing logged {p.this} yet.</span>
        )}
        {members.length > 1 && <span className="muted small">An even split between {members.length} would be {pct(1 / members.length)} each.</span>}
      </div>

      <div className="panel stack">
        {r.members.map((m) => (
          <Meter
            key={m.member.id}
            strong={m.member.id === focusId}
            label={`${m.member.animal} ${m.member.name}${m.member.id === focusId ? ' (you)' : ''}`}
            value={m.acorns}
            max={max}
            text={`${acorns(m.acorns)} · ${m.done} done`}
          />
        ))}
        <p className="muted small">A job done together splits its acorns between everyone tagged.</p>
      </div>

      <BarChart
        title={`Your share, last ${p.bars} ${period === 'day' ? 'days' : period === 'week' ? 'weeks' : 'months'}`}
        max={1}
        {...(members.length > 1 && { guide: { value: 1 / members.length, label: `even split ${pct(1 / members.length)}` } })}
        bars={r.trend.map((b) => ({
          key: String(b.start),
          label: b.current ? (period === 'day' ? 'Today' : 'Now') : b.label,
          value: b.share,
          text: b.share == null ? 'nothing logged' : pct(b.share),
          current: b.current,
        }))}
      />

      <p className="muted small center-text">🔒 Only shown to whoever started the habitat. Everyone else sees the pack’s report.</p>
    </div>
  );
}

const PERIOD_KEY = 'eco.report.period';
const PERIOD_IDS = Object.keys(PERIODS) as Period[];

export function Report() {
  const { me, ownerId, ctx } = useHabitat();
  const [period, setPeriodState] = useState<Period>(() => PERIOD_IDS.find((p) => p === readLocal(PERIOD_KEY)) ?? 'week');
  const [view, setView] = useState<'pack' | 'share'>('pack');
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    writeLocal(PERIOD_KEY, p);
  };
  const since = reportSince(ctx.now);
  const wins = useLiveQuery(() => db.wins.where('at').aboveOrEqual(since).toArray(), [since]);
  // The demo and a local-only habitat have no owner: whoever is using it sees everything.
  const canSeeShare = !!me && (isRemote() ? me.id === ownerId : true);
  const showing = canSeeShare ? view : 'pack';

  return (
    <div className="stack">
      <div className="chips" role="radiogroup" aria-label="Period">
        {PERIOD_IDS.map((p) => (
          <button key={p} role="radio" aria-checked={period === p} className={`chip${period === p ? ' on' : ''}`} onClick={() => setPeriod(p)}>
            {PERIODS[p].label}
          </button>
        ))}
      </div>
      {canSeeShare && (
        <div className="chips" role="radiogroup" aria-label="Report">
          <button role="radio" aria-checked={showing === 'pack'} className={`chip${showing === 'pack' ? ' on' : ''}`} onClick={() => setView('pack')}>
            🐾 The pack
          </button>
          <button role="radio" aria-checked={showing === 'share'} className={`chip${showing === 'share' ? ' on' : ''}`} onClick={() => setView('share')}>
            ⚖️ My share
          </button>
        </div>
      )}
      {!wins ? <p className="muted">Adding up…</p> : showing === 'share' ? <ShareView period={period} wins={wins} /> : <PackView period={period} wins={wins} />}
    </div>
  );
}
