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
  const [error, setError] = useState<string>();

  if (!asking) {
    return (
      <>
        <button
          type="button"
          className={className}
          disabled={disabled}
          onClick={() => {
            setError(undefined);
            setAsking(true);
          }}
        >
          {children}
        </button>
        {error && <p className="small error-text">{error}</p>}
      </>
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
        } catch (e) {
          // Never fail silently: say what went wrong next to the button.
          setError(e instanceof Error ? e.message : 'That didn’t work. Please try again.');
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
