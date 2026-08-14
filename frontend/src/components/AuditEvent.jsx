import React from 'react';
import { Eye, ShieldAlert, ShieldCheck, ShieldX, Stamp } from 'lucide-react';
import { formatDate, formatRelative } from '../lib/format';

/*
 * Every audit event used to render as an identical grey card, which meant a
 * denied access attempt — the one event a customer should notice immediately —
 * looked exactly like a routine consent grant.
 */
const EVENT_STYLES = {
  KYC_VERIFIED: { icon: Stamp, color: 'var(--primary)', tint: 'var(--primary-soft)', ring: 'var(--primary-border)' },
  CONSENT_GRANTED: { icon: ShieldCheck, color: 'var(--success)', tint: 'var(--success-soft)', ring: 'var(--success-border)' },
  CONSENT_REVOKED: { icon: ShieldX, color: 'var(--warning)', tint: 'var(--warning-soft)', ring: 'var(--warning-border)' },
  ACCESS_GRANTED: { icon: Eye, color: 'var(--text-muted)', tint: 'var(--surface-sunken)', ring: 'var(--border-strong)' },
  ACCESS_DENIED: { icon: ShieldAlert, color: 'var(--danger)', tint: 'var(--danger-soft)', ring: 'var(--danger-border)' }
};

const FALLBACK = EVENT_STYLES.ACCESS_GRANTED;

export function AuditEvent({ event }) {
  const style = EVENT_STYLES[event.type] || FALLBACK;
  const Icon = style.icon;
  const isAlert = event.type === 'ACCESS_DENIED';

  return (
    <li
      className="flex gap-3 rounded-lg border px-3 py-2.5"
      style={{
        background: isAlert ? style.tint : 'var(--surface)',
        borderColor: isAlert ? style.ring : 'var(--border)'
      }}
    >
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{ background: style.tint, color: style.color }}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-sm font-semibold text-[color:var(--text)]">{event.title}</p>
          <time
            className="shrink-0 text-xs text-[color:var(--text-subtle)]"
            dateTime={event.timestamp}
            title={formatDate(event.timestamp)}
          >
            {formatRelative(event.timestamp)}
          </time>
        </div>
        <p className="t-body mt-0.5">{event.description}</p>
        {event.hash ? <p className="t-mono mt-1 break-all text-xs">{event.hash}</p> : null}
      </div>
    </li>
  );
}
