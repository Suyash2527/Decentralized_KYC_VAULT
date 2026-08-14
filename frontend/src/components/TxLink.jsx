import React from 'react';
import { ExternalLink } from 'lucide-react';
import { EXPLORER_URL } from '../lib/api';
import { truncateHash } from '../lib/format';
import { CopyButton } from './ui';

/*
 * The on-chain proof is the whole point of the product, so a transaction hash
 * is rendered as a link to the block explorer rather than as inert grey text.
 */
export function TxLink({ hash, label = 'Transaction', kind = 'tx' }) {
  if (!hash) {
    return null;
  }

  return (
    <div className="well flex items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="t-label">{label}</p>
        <a
          href={`${EXPLORER_URL}/${kind}/${hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-mono text-[0.8125rem] font-medium text-[color:var(--primary)] underline decoration-[color:var(--primary-border)] underline-offset-2 hover:decoration-[color:var(--primary)]"
        >
          {truncateHash(hash, 10, 8)}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">(opens block explorer in a new tab)</span>
        </a>
      </div>
      <CopyButton value={hash} label="Copy hash" />
    </div>
  );
}
