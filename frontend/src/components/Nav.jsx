import React from 'react';
import { Link } from 'react-router-dom';
import { Link2, LogOut, ShieldCheck } from 'lucide-react';
import { CONTRACT_ADDRESS, EXPLORER_URL, NETWORK_NAME } from '../lib/api';
import { ROLE_LABELS, truncateHash } from '../lib/format';
import { IconButton } from './ui';

const ROLE_ACCENT = {
  VERIFIER: 'var(--role-verifier)',
  CUSTOMER: 'var(--role-customer)',
  PARTNER: 'var(--role-partner)'
};

export function Nav({ user, onLogout }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-[color:var(--surface)]">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ background: user ? ROLE_ACCENT[user.role] : 'var(--primary)' }}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="truncate text-[0.9375rem] font-semibold tracking-tight">KYC Vault</span>

          {/* A blockchain product should always say which chain it is on. */}
          <span className="ml-1 hidden items-center gap-1.5 rounded-md border px-2 py-1 sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--success)]" aria-hidden="true" />
            <span className="text-xs font-medium text-[color:var(--text-muted)]">{NETWORK_NAME}</span>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/chain"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[color:var(--text-muted)] hover:text-[color:var(--primary)]"
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">On-chain proof</span>
          </Link>

          {CONTRACT_ADDRESS ? (
            <a
              href={`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden font-mono text-xs text-[color:var(--text-subtle)] underline underline-offset-2 hover:text-[color:var(--primary)] lg:inline"
            >
              {truncateHash(CONTRACT_ADDRESS, 6, 4)}
            </a>
          ) : null}

          {user ? (
            <>
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium leading-tight">{user.username}</p>
                <p className="text-xs leading-tight text-[color:var(--text-subtle)]">{ROLE_LABELS[user.role]}</p>
              </div>
              <IconButton label="Log out" icon={LogOut} onClick={onLogout} />
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
