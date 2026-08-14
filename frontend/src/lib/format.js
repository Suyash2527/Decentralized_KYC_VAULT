export function formatDate(value) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function formatRelative(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString();
}

export function truncateHash(hash, lead = 6, tail = 4) {
  if (typeof hash !== 'string' || hash.length <= lead + tail + 2) {
    return hash || '';
  }

  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

/*
 * Government IDs are masked by default. A partner console sits on a shared
 * bank desk, so a full Aadhaar number should never be on screen unless someone
 * deliberately reveals it.
 */
export function maskGovId(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  const trimmed = value.trim();

  // Values the backend substitutes for withheld fields are not IDs.
  if (/^(hidden|verified)/i.test(trimmed)) {
    return trimmed;
  }

  const visible = trimmed.slice(-4);
  const masked = trimmed.slice(0, -4).replace(/[^\s-]/g, '×');

  return `${masked}${visible}`;
}

export function formatCountdown(secondsRemaining) {
  const safe = Math.max(0, Math.floor(secondsRemaining));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const ROLE_LABELS = {
  VERIFIER: 'Verifier Bank',
  CUSTOMER: 'Customer',
  PARTNER: 'Partner Institution'
};

export const ROLE_HOME = {
  VERIFIER: '/bank',
  CUSTOMER: '/customer',
  PARTNER: '/partner'
};
