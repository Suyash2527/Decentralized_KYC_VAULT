import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

const ToastContext = createContext(null);

const TOAST_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info
};

const TOAST_STYLES = {
  success: 'border-l-4 border-l-[color:var(--success)]',
  error: 'border-l-4 border-l-[color:var(--danger)]',
  warning: 'border-l-4 border-l-[color:var(--warning)]',
  info: 'border-l-4 border-l-[color:var(--primary)]'
};

const TOAST_ICON_COLOR = {
  success: 'text-[color:var(--success)]',
  error: 'text-[color:var(--danger)]',
  warning: 'text-[color:var(--warning)]',
  info: 'text-[color:var(--primary)]'
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (variant, message, options = {}) => {
      idRef.current += 1;
      const id = idRef.current;
      const duration = options.duration ?? (variant === 'error' ? 7000 : 4500);

      setToasts((current) => [...current, { id, variant, message, title: options.title }]);

      if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
      }

      return id;
    },
    [dismiss]
  );

  const toast = useMemo(
    () => ({
      success: (message, options) => push('success', message, options),
      error: (message, options) => push('error', message, options),
      warning: (message, options) => push('warning', message, options),
      info: (message, options) => push('info', message, options)
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className="fixed top-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((item) => {
          const Icon = TOAST_ICONS[item.variant];

          return (
            <div
              key={item.id}
              role="status"
              aria-live={item.variant === 'error' ? 'assertive' : 'polite'}
              className={`card animate-slide-in flex items-start gap-3 p-3 shadow-[var(--shadow-lg)] ${TOAST_STYLES[item.variant]}`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TOAST_ICON_COLOR[item.variant]}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {item.title ? <p className="text-sm font-semibold text-[color:var(--text)]">{item.title}</p> : null}
                <p className="t-body break-words">{item.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="btn btn-ghost btn-icon shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used inside a ToastProvider.');
  }

  return context;
}
