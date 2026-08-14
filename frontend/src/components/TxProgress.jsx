import React from 'react';
import { Check } from 'lucide-react';
import { Spinner } from './ui';

/*
 * A write to Sepolia takes 12-30 seconds. A single "Processing..." label for
 * that long reads as a hung app, so the request is broken into the stages the
 * backend actually moves through.
 */
export const TX_STAGES = [
  { key: 'encrypting', label: 'Encrypting PII' },
  { key: 'broadcasting', label: 'Broadcasting transaction' },
  { key: 'confirming', label: 'Awaiting confirmation' }
];

export function TxProgress({ stage }) {
  if (!stage) {
    return null;
  }

  const activeIndex = TX_STAGES.findIndex((item) => item.key === stage);

  return (
    <ol className="well space-y-2 px-3 py-2.5" aria-live="polite">
      {TX_STAGES.map((item, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;

        return (
          <li key={item.key} className="flex items-center gap-2.5">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {done ? (
                <Check className="h-3.5 w-3.5 text-[color:var(--success)]" aria-hidden="true" />
              ) : active ? (
                <Spinner className="h-3.5 w-3.5 text-[color:var(--primary)]" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--border-strong)]" aria-hidden="true" />
              )}
            </span>
            <span
              className={`text-[0.8125rem] ${
                done
                  ? 'text-[color:var(--text-subtle)] line-through'
                  : active
                    ? 'font-medium text-[color:var(--text)]'
                    : 'text-[color:var(--text-subtle)]'
              }`}
            >
              {item.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
