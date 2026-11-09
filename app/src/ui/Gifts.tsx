import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { giftSeen, sendGift } from '../data/actions';
import { db } from '../data/db';
import { GIFTS } from '../domain/acorns';
import { DAY } from '../domain/dates';
import { GIFT_ORDER, type GiftKind } from '../domain/types';
import { useHabitat } from './habitat';
import { useTotals } from './Bounties';

/** The purse: your acorns, and what they can buy. Only whoever is using the device sees it. */
export function PurseSheet({ onClose }: { onClose(): void }) {
  const { me, members } = useHabitat();
  const totals = useTotals();
  const [kind, setKind] = useState<GiftKind>();
  const [sent, setSent] = useState<string>();
  const [error, setError] = useState<string>();
  const sheet = useRef<HTMLDivElement>(null);
  const others = members.filter((m) => m.id !== me?.id).sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!me || totals?.acorns === undefined) return null;
  const acorns = totals.acorns;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-labelledby="purse-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <div>
            <h3 id="purse-title">🌰 {acorns.toLocaleString()} acorns</h3>
            <p className="muted small">Earned by everything you do, plus bounties. Only you see these.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {sent ? (
          <div className="panel stack center-text">
            <p>{sent}</p>
            <button className="btn-soft" onClick={onClose}>
              Lovely
            </button>
          </div>
        ) : (
          <>
            <fieldset className="field">
              <legend>Send something kind</legend>
              <div className="chips wrap">
                {GIFT_ORDER.map((k) => (
                  <button key={k} type="button" className={`chip${kind === k ? ' on' : ''}`} aria-pressed={kind === k} disabled={acorns < GIFTS[k].acorns} onClick={() => setKind(k)}>
                    {GIFTS[k].emoji} {GIFTS[k].label} · 🌰 {GIFTS[k].acorns}
                  </button>
                ))}
              </div>
            </fieldset>

            {kind && (
              <fieldset className="field">
                <legend>Who for?</legend>
                {others.length === 0 ? (
                  <p className="muted small">There’s nobody else in the pack yet.</p>
                ) : (
                  <div className="chips wrap">
                    {others.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="chip"
                        onClick={async () => {
                          setError(undefined);
                          try {
                            await sendGift(kind, me.id, m.id);
                            setSent(`${GIFTS[kind].emoji} Your ${GIFTS[kind].label.toLowerCase()} is on its way to ${m.animal} ${m.name}.`);
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'That didn’t send. Please try again.');
                          }
                        }}
                      >
                        {m.animal} {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </fieldset>
            )}
            {error && <p className="small error-text">{error}</p>}
            {acorns < Math.min(...GIFT_ORDER.map((k) => GIFTS[k].acorns)) && <p className="muted small">Doing a few things earns enough for one.</p>}
          </>
        )}
      </div>
    </div>
  );
}

/** How long a hug waits on Home if nobody taps it: then it quietly goes, so it never becomes something to deal with. */
const SHOWN_FOR_MS = 3 * DAY;

/** Hugs, high-fives and thank yous for whoever is using this device, on Home (just above the bounty board) until they close them. */
export function GiftsForYou() {
  const { me, memberById, ctx } = useHabitat();
  const gifts = useLiveQuery(
    async () =>
      me
        ? (await db.gifts.where('toId').equals(me.id).toArray()).filter((g) => !g.seenAt && g.sentAt > ctx.now - SHOWN_FOR_MS).sort((a, b) => a.sentAt - b.sentAt)
        : [],
    [me?.id, ctx.now],
  );
  if (!gifts?.length) return null;
  return (
    <div className="stack" aria-label="Sent to you">
      {gifts.map((g) => {
        const from = memberById.get(g.fromId);
        const gift = GIFTS[g.kind];
        return (
          <div key={g.id} className="panel gift-note">
            <span className="gift-emoji" aria-hidden>
              {gift.emoji}
            </span>
            <span className="gift-text">
              {from ? `${from.animal} ${from.name}` : 'Someone in the pack'} {gift.arrives}
            </span>
            <button className="icon-btn" onClick={() => void giftSeen(g.id)} aria-label="Close">
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
