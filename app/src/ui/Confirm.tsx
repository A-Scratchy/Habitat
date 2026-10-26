import { useState, type ReactNode } from 'react';

/**
 * A button that asks "are you sure?" in place, instead of a native confirm() pop-up
 * (jarring, and blocked in some embedded browsers, where it silently answers "no").
 */
export function ConfirmButton({
  className = 'btn-soft',
  question,
  confirmLabel,
  onConfirm,
  disabled,
  children,
}: {
  className?: string;
  question: string;
  confirmLabel: string;
  onConfirm(): unknown;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }

  return (
    <ConfirmPanel
      question={question}
      confirmLabel={busy ? '…' : confirmLabel}
      busy={busy}
      onCancel={() => setAsking(false)}
      onConfirm={async () => {
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setAsking(false);
        }
      }}
    />
  );
}

/** The question and its two answers, for flows that need to ask mid-way (e.g. after picking a file). */
export function ConfirmPanel({ question, confirmLabel, onConfirm, onCancel, busy }: { question: string; confirmLabel: string; onConfirm(): unknown; onCancel(): void; busy?: boolean }) {
  return (
    <div className="panel stack confirm" role="group" aria-label={question}>
      <p className="small">{question}</p>
      <div className="actions">
        <button type="button" className="btn-done" disabled={busy} onClick={() => void onConfirm()} autoFocus>
          {confirmLabel}
        </button>
        <button type="button" className="btn-soft" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
