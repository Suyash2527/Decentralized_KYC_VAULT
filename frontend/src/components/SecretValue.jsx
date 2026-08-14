import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { maskGovId } from '../lib/format';
import { CopyButton } from './ui';

/*
 * Government IDs render masked. A partner console is typically a shared desk
 * terminal, so the full number is shown only on a deliberate action.
 */
export function SecretValue({ label, value, allowCopy = true }) {
  const [revealed, setRevealed] = useState(false);

  if (!value) {
    return null;
  }

  const isWithheld = /^(hidden|verified)/i.test(String(value).trim());

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="t-label">{label}</p>
        <p className="font-mono text-sm text-[color:var(--text)]">{revealed ? value : maskGovId(value)}</p>
      </div>
      {!isWithheld ? (
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            className="btn btn-ghost btn-icon"
            aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
            aria-pressed={revealed}
          >
            {revealed ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
          {allowCopy ? <CopyButton value={value} label={`Copy ${label}`} /> : null}
        </div>
      ) : null}
    </div>
  );
}
