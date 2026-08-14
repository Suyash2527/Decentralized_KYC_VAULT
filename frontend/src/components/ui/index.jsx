import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Loader2, X } from 'lucide-react';

export function Spinner({ className = 'h-4 w-4' }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />;
}

export function Card({ children, className = '', as: Tag = 'section', ...rest }) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ icon: Icon, title, description, accent = 'var(--primary)', actions }) {
  return (
    <div className="card-header">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--surface-sunken)', color: accent }}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="t-title">{title}</h2>
          {description ? <p className="t-body mt-0.5">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  size,
  loading = false,
  icon: Icon,
  className = '',
  disabled,
  ...rest
}) {
  return (
    <button
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, icon: Icon, variant = 'ghost', className = '', ...rest }) {
  return (
    <button type="button" className={`btn btn-${variant} btn-icon ${className}`} aria-label={label} title={label} {...rest}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/*
 * Field owns the label/input/error association. Doing it here rather than at
 * each call site is what guarantees every input in the app is actually labelled
 * for assistive tech, and that errors are announced.
 */
export function Field({ label, hint, error, children, id: providedId }) {
  const generatedId = useId();
  const id = providedId || generatedId;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ');

  return (
    <div>
      <label htmlFor={id} className="t-label mb-1.5 block">
        {label}
      </label>
      {React.cloneElement(children, {
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? 'true' : undefined,
        className: `${children.props.className || 'input'}${error ? ' input-error' : ''}`
      })}
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-[color:var(--text-subtle)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-[color:var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Badge({ children, variant = 'neutral', icon: Icon, className = '' }) {
  return (
    <span className={`badge badge-${variant} ${className}`}>
      {Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="well flex flex-col items-center justify-center px-6 py-8 text-center">
      {Icon ? <Icon className="mb-2 h-6 w-6 text-[color:var(--text-subtle)]" aria-hidden="true" /> : null}
      <p className="text-sm font-medium text-[color:var(--text)]">{title}</p>
      {description ? <p className="t-body mt-1 max-w-xs">{description}</p> : null}
    </div>
  );
}

export function CopyButton({ value, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`btn btn-ghost btn-icon ${className}`}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[color:var(--success)]" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

/*
 * Modal traps focus, restores it on close, and closes on Escape. The screens it
 * replaces used window.confirm(), which blocked the main thread and could not
 * be styled or made keyboard-consistent.
 */
export function Modal({ open, onClose, title, description, children, footer }) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    previouslyFocused.current = document.activeElement;
    const node = dialogRef.current;
    node?.querySelector('[data-autofocus]')?.focus() ?? node?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !node) {
        return;
      }

      const focusable = node.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[rgba(15,23,42,0.45)]" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="card animate-fade-up relative z-10 w-full max-w-md shadow-[var(--shadow-lg)]"
      >
        <div className="card-header">
          <h2 id="modal-title" className="t-title">
            {title}
          </h2>
          <IconButton label="Close dialog" icon={X} onClick={onClose} />
        </div>
        <div className="card-body">
          {description ? <p className="t-body">{description}</p> : null}
          {children}
        </div>
        {footer ? <div className="flex justify-end gap-2 border-t px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/*
 * Irreversible actions require the user to type an exact phrase. A single
 * "are you sure" click is too easy to fire by muscle memory when the outcome is
 * permanent deletion.
 */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  confirmPhrase,
  loading = false
}) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) {
      setTyped('');
    }
  }, [open]);

  const canConfirm = !confirmPhrase || typed.trim().toUpperCase() === confirmPhrase.toUpperCase();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger-solid" onClick={onConfirm} disabled={!canConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {confirmPhrase ? (
        <div className="mt-4">
          <Field
            label={
              <>
                Type <span className="font-mono">{confirmPhrase}</span> to confirm
              </>
            }
          >
            <input
              className="input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={confirmPhrase}
              autoComplete="off"
              data-autofocus
            />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}
